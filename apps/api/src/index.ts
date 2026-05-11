import {
  createD1FolderRepository,
  createD1OAuthRepository,
  createD1SourceRepository,
  createGoogleDocExtractor,
  createGoogleDriveConnector,
  createGoogleSheetExtractor,
  createGoogleSlideExtractor,
  createKVOAuthStateStore,
  createPdfExtractor,
  createR2SourceStorage,
} from '@domain/ingestion/infrastructure';
import type { IngestionContext } from '@domain/ingestion/interface';
import { OAuthTokenUnreadable } from '@domain/ingestion/ports';
import { subscribeWikiEvents } from '@domain/wiki/interface';
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import type { UserId } from '@package/contracts/shared';
import {
  InMemoryEventBus,
  type Tracer,
  newId,
  resolveTracer,
  systemClock,
} from '@package/shared-kernel';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildChatContext } from './build-chat-context.ts';
import { buildVerificationContext } from './build-verification-deps.ts';
import { type WikiBindings, buildWikiContext, getSharedEventBus } from './build-wiki-deps.ts';
import { mountDevRoutes } from './dev-routes.ts';
import {
  REFRESH_SKEW_MS,
  createAesGcmCipher,
  googleOAuthConfig,
  mountIngestionAuthCallback,
  refreshGoogleAccessToken,
  resolveTokenKey,
} from './oauth-helpers.ts';
import { router } from './router.ts';
import { buildSetCookieHeader, resolveSession, signSession } from './session.ts';
import { mountSourceArtifacts } from './source-artifacts.ts';
import { userIdFromDriveEmail } from './user-id-from-email.ts';

// Featured wiki shown to anonymous visitors. The wikis list is otherwise
// per-user-scoped (no session → no listing), so surfacing this one wiki
// keeps the landing page non-empty in incognito. Hard-coded for the
// single-tenant demo; multi-tenant would lift this to per-org config.
const FEATURED_WIKI_ID = 'cb0b020d-50ab-41cb-91d9-09a5dda547b2';

// Drive OAuth credentials accept both `GOOGLE_OAUTH_*` and bare `GOOGLE_*`
// names; see `googleOAuthConfig` in `oauth-helpers.ts`. `WEB_APP_ORIGINS` is
// the post-OAuth redirect allowlist (open-redirect prevention).
// `OAUTH_TOKEN_KEY_BASE64` is required in non-test envs; `resolveTokenKey`
// throws at boot when missing. `SESSION_SIGNING_KEY` is required to verify
// `tenex_sid` cookies; missing it crashes `resolveSessionSigningKey` rather
// than silently treating every cookie as forged. Generate with
// `openssl rand -base64 32`.
type Env = WikiBindings & {
  ENVIRONMENT: string;
  DB: D1Database;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT?: string;
  WEB_APP_ORIGINS?: string;
  OAUTH_TOKEN_KEY_BASE64: string;
  SESSION_SIGNING_KEY?: string;
  // Observability — all optional. `resolveTracer` falls back to a console
  // exporter when none are set, so dev keeps showing one JSON-line-per-span
  // in wrangler tail without any config. Setting the Langfuse trio derives
  // the OTLP endpoint + Basic-auth header automatically; a bare OTEL
  // endpoint works the same way with whatever headers
  // `OTEL_EXPORTER_OTLP_HEADERS` carries.
  LANGFUSE_HOST?: string;
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
};

// Hono per-request variables. The session middleware writes `userId` once at
// the start of every `/rpc/*` request so downstream handlers, the oRPC
// dispatcher, and the source-artifact gate all read from one source of
// truth — no re-parsing the cookie, no `as never` casts.
type Variables = { userId: UserId | null };

const resolveSessionSigningKey = (env: Env): string | undefined => {
  if (env.SESSION_SIGNING_KEY) return env.SESSION_SIGNING_KEY;
  if (env.ENVIRONMENT === 'test') return undefined;
  // Fail loud at boot rather than silently treating every cookie as forged
  // (which would 401 every authenticated route in production).
  throw new Error(
    'SESSION_SIGNING_KEY is required in non-test environments. ' +
      'Set it in apps/api/.dev.vars locally, or via `wrangler secret put` for prod. ' +
      'Generate a fresh key with: openssl rand -base64 32',
  );
};

/**
 * Construct the per-request tracer. Composition rule of thumb (see
 * `@package/shared-kernel/observability`): Langfuse env vars win over generic
 * OTLP, OTLP wins over console, console is the default. `ctx.waitUntil` keeps
 * the export fetch alive past response flush; without it the OTLP exporter
 * fires-and-forgets (still OK locally, lossy under prod scaling).
 */
const buildTracer = (env: Env, waitUntil: ((p: Promise<unknown>) => void) | undefined): Tracer =>
  resolveTracer(env, {
    serviceName: env.ENVIRONMENT === 'production' ? 'tenex-api' : `tenex-api-${env.ENVIRONMENT}`,
    ...(waitUntil ? { waitUntil } : {}),
  });

/**
 * Build the ingestion context for a specific resolved UserId.
 *
 * When `currentUserId` is `null` (anonymous request, or the OAuth callback
 * pre-handshake), the Drive token resolver throws on first use; the
 * ingestion interface maps the throw to `ORPCError('UNAUTHORIZED')`. When
 * the userId resolves, every D1 read/write hits THAT user's row — no
 * cross-tenant leakage to a hard-coded demo id.
 */
const buildIngestionContext = (env: Env, currentUserId: UserId | null): IngestionContext => {
  const cipher = createAesGcmCipher(resolveTokenKey(env));
  const oauth = createD1OAuthRepository(env.DB, cipher);

  // SF2: keep `OAuthTokenUnreadable` visible to the oRPC layer so handlers
  // return a typed 401 with a "Re-connect Drive" message, not a 500.
  const loadOrThrow = async (id: UserId) => {
    try {
      return await oauth.loadTokens(id);
    } catch (err) {
      if (err instanceof OAuthTokenUnreadable) throw err;
      throw err;
    }
  };

  // SF6/SF7: per-request access-token resolver. Honors `forceRefresh` after
  // a 401, and proactively refreshes when within REFRESH_SKEW_MS of expiry.
  // The ingestion router maps the "No Drive tokens" throw into
  // `ORPCError('UNAUTHORIZED')`.
  const getCurrentAccessToken = async (opts: { forceRefresh?: boolean } = {}): Promise<string> => {
    if (!currentUserId) {
      throw new Error('No Drive tokens — sign in to Drive first.');
    }
    const stored = await loadOrThrow(currentUserId);
    if (!stored) throw new Error('No Drive tokens — call ingestion.authStart first.');
    const expiresAt = Date.parse(stored.expiresAt);
    const isExpiring = Number.isFinite(expiresAt) && expiresAt - Date.now() < REFRESH_SKEW_MS;
    if (!opts.forceRefresh && !isExpiring) return stored.accessToken;
    const refreshed = await refreshGoogleAccessToken(env, stored.refreshToken);
    await oauth.saveTokens({
      userId: currentUserId,
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    });
    return refreshed.accessToken;
  };

  return {
    drive: (() => {
      const cfg = googleOAuthConfig(env);
      return createGoogleDriveConnector({
        clientId: cfg.clientId,
        clientSecret: cfg.clientSecret,
        redirectUri: cfg.redirectUri,
        // Pre-OAuth: the callback path builds this context with
        // `currentUserId: null`, so the connector falls back to deriving a
        // stable UserId from the Drive profile email. Post-OAuth: the
        // cookie carries the same id and this resolver short-circuits.
        resolveUserId: (email) => currentUserId ?? userIdFromDriveEmail(email),
        getCurrentAccessToken,
      });
    })(),
    storage: createR2SourceStorage(env.STORAGE),
    sources: createD1SourceRepository(env.DB),
    folders: createD1FolderRepository(env.DB),
    oauth,
    oauthState: createKVOAuthStateStore(env.CACHE),
    eventBus: new InMemoryEventBus(),
    extractors: {
      pdf: createPdfExtractor(),
      doc: createGoogleDocExtractor(),
      sheet: createGoogleSheetExtractor(),
      slide: createGoogleSlideExtractor(),
    },
    newId,
    now: () => new Date(),
    clock: systemClock,
    ...(currentUserId ? { currentUserId } : {}),
  };
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use(
  '/rpc/*',
  cors({
    origin: (origin) => origin,
    credentials: true,
  }),
);

// Session middleware. Resolves the signed `tenex_sid` cookie into a UserId
// (or `null` for anonymous) once per request and stashes it on
// `c.var.userId` so the rest of the pipeline doesn't re-parse the cookie.
// `resolveSession` short-circuits to a fixed `TEST_USER_ID` when
// `ENVIRONMENT === 'test'` so `router.test.ts` can exercise authenticated
// routes without provisioning a signing key.
app.use('/rpc/*', async (c, next) => {
  const env = (c.env ?? { ENVIRONMENT: 'test' }) as Env;
  const signingKey = resolveSessionSigningKey(env);
  const resolved = await resolveSession({
    cookieHeader: c.req.raw.headers.get('cookie'),
    ...(signingKey ? { signingKeyBase64: signingKey } : {}),
    environment: env.ENVIRONMENT,
  });
  c.set('userId', resolved);
  await next();
});

// Mount the GET OAuth callback BEFORE the oRPC dispatcher. After
// `completeDriveAuth` resolves the userId, the injected `mintSessionCookie`
// returns a signed `Set-Cookie` value the helper attaches to the 302. Cookie
// internals live entirely in `session.ts`; this composition root only
// supplies the signing key.
mountIngestionAuthCallback<Env>(app, {
  buildIngestionContext,
  mintSessionCookie: async (env, userId) => {
    const signingKey = resolveSessionSigningKey(env);
    if (!signingKey) return null;
    const value = await signSession({ userId, signingKeyBase64: signingKey });
    return buildSetCookieHeader({ value });
  },
});

// Each sub-router is bound to its own `$context<X>` type. RPCHandler can't
// unify those into a single nominal context, so we erase the router type at
// construction. The per-handler `.handler(...)` callbacks still see their
// own typed context slice; only the multi-context spread at handle time is
// unsafe, and we control what we pass there.
// biome-ignore lint/suspicious/noExplicitAny: cross-context router type erasure
const handler = new RPCHandler(router as any, {
  interceptors: [
    onError((error) => {
      console.error('[orpc]', error);
    }),
  ],
});

let subscriptionsBootstrapped = false;
const bootstrapSubscriptions = (env: Partial<WikiBindings>) => {
  if (subscriptionsBootstrapped) return;
  subscriptionsBootstrapped = true;
  const ctx = buildWikiContext(env, systemClock);
  subscribeWikiEvents(ctx.eventBus);
};

// Single-instance chat context, built lazily on first request and cached for
// subsequent ones. The dispatcher's in-memory tape lives on this instance —
// rebuilding it per request would lose in-flight chat conversations.
//
// Tracer note: the chat singleton bakes in the tracer it first sees because
// the Researcher / Synthesizer adapters store it at construction time. In
// practice the env doesn't change between requests on a single Worker
// instance, so the resolved tracer is stable. The `waitUntil` it captures
// comes from the *first* request — subsequent requests' spans still fire,
// but their OTLP export uses the original execution context's keepalive
// (or fire-and-forget if the first request didn't expose one). This is
// adequate for prod observability; per-span request scoping would require
// a tracer factory at the adapter layer.
let chatContextSingleton: ReturnType<typeof buildChatContext> | null = null;
const ensureChatContext = (env: Env, tracer: Tracer) => {
  if (chatContextSingleton) return chatContextSingleton;
  chatContextSingleton = buildChatContext({
    eventBus: getSharedEventBus(),
    bindings: {
      db: env.DB,
      storage: env.STORAGE,
      openRouterApiKey: (env as unknown as { OPEN_ROUTER_API_KEY?: string }).OPEN_ROUTER_API_KEY,
    },
    tracer,
    // When bound, use the Durable Object dispatcher so chat.ask and
    // chat.streamAnswer survive landing on different Worker isolates.
    ...((env as unknown as { CHAT_TURN?: DurableObjectNamespace }).CHAT_TURN
      ? {
          chatTurnNamespace: (env as unknown as { CHAT_TURN: DurableObjectNamespace }).CHAT_TURN,
        }
      : {}),
  });
  return chatContextSingleton;
};

// oRPC dispatcher. Builds the per-request flat context, applies two
// shell-level policies, and delegates to the router:
//   1. `chat.open` requires a signed-in user → otherwise 401
//   2. anonymous `wiki.listWikis` is rewritten to return only the featured
//      demo wiki — keeps every other user's wikis private
app.use('/rpc/*', async (c, next) => {
  const env = (c.env ?? { ENVIRONMENT: 'test' }) as Env;
  const userId = c.var.userId;
  const { slug, procedure } = parseRpcPath(c.req.raw.url);

  if (!userId && slug === 'chat' && procedure === 'open') {
    return c.json(
      { defined: false, code: 'UNAUTHORIZED', message: 'Sign in to start a conversation.' },
      401,
    );
  }

  bootstrapSubscriptions(env);
  // `c.executionCtx` is a getter that throws outside a Workers runtime
  // (e.g. `bun:test`). Guard the access so this middleware doesn't 500 the
  // test path; we just lose the OTLP keepalive there (the export becomes
  // fire-and-forget — fine locally).
  let waitUntil: ((p: Promise<unknown>) => void) | undefined;
  try {
    const ec = c.executionCtx;
    if (ec?.waitUntil) waitUntil = (p: Promise<unknown>) => ec.waitUntil(p);
  } catch {
    waitUntil = undefined;
  }
  const tracer = buildTracer(env, waitUntil);
  const flat = buildFlatContext(env, userId, slug, waitUntil, tracer);

  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: '/rpc',
    // biome-ignore lint/suspicious/noExplicitAny: cross-context union — see RPCHandler comment above
    context: flat as any,
  });
  if (!matched) {
    await next();
    return;
  }
  if (!userId && slug === 'wiki' && procedure === 'listWikis' && response.ok) {
    return keepOnlyFeaturedWiki(response);
  }
  return c.newResponse(response.body, response);
});

app.get('/', (c) => c.text('tenex api'));

// `mountSourceArtifacts` gates `/raw` and `/outline.json` (non-excerpt
// full-source material) behind a session. `/text` stays public because wiki
// bodies embed extracted excerpts and the citation popovers read that URL
// anonymously from the featured wiki.
mountSourceArtifacts(app, {
  requireSession: async (request, env) => {
    const fullEnv = env as unknown as Env;
    if (fullEnv.ENVIRONMENT === 'test') return null;
    const signingKey = resolveSessionSigningKey(fullEnv);
    const resolved = await resolveSession({
      cookieHeader: request.headers.get('cookie'),
      ...(signingKey ? { signingKeyBase64: signingKey } : {}),
      environment: fullEnv.ENVIRONMENT,
    });
    if (resolved) return null;
    return new Response(JSON.stringify({ error: 'session required' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  },
});

mountDevRoutes(app);

export { ChatTurnDO, CompileRunDO } from './durable-objects.ts';
export default app;

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────────

const parseRpcPath = (rawUrl: string): { slug: string; procedure: string } => {
  const segments = new URL(rawUrl).pathname.split('/');
  return { slug: segments[2] ?? '', procedure: segments[3] ?? '' };
};

/**
 * Build the per-request flat context fed to the oRPC dispatcher.
 *
 * Ports collide across contexts (wiki/chat/verification share `dispatcher`,
 * wiki/verification share `runs`, wiki/ingestion share `sources`). A naive
 * spread lets the last writer silently win, so we pick precedence by router
 * slug; the chat slice additionally needs `waitUntil` injected so its
 * fire-and-forget research loop (SF-CHAT-11) survives the response flush.
 *
 * `tracer` is threaded into every domain-builder so spans emitted from the
 * use-cases share a root parent across the whole request.
 */
const buildFlatContext = (
  env: Env,
  userId: UserId | null,
  slug: string,
  waitUntil: ((p: Promise<unknown>) => void) | undefined,
  tracer: Tracer,
): Record<string, unknown> => {
  const ingestion = buildIngestionContext(env, userId);
  const wiki = buildWikiContext(env, systemClock, tracer);
  const chatContext = ensureChatContext(env, tracer);
  const verification = buildVerificationContext(
    env as unknown as Parameters<typeof buildVerificationContext>[0],
    getSharedEventBus(),
    systemClock,
    tracer,
  );
  const flat: Record<string, unknown> = {
    ...wiki,
    ...ingestion,
    ...chatContext,
    ...verification,
    clock: systemClock,
    currentUserId: userId ?? undefined,
  };
  switch (slug) {
    case 'wiki':
      Object.assign(flat, { dispatcher: wiki.dispatcher, runs: wiki.runs, sources: wiki.sources });
      break;
    case 'chat':
      Object.assign(flat, { dispatcher: chatContext.dispatcher, waitUntil });
      break;
    case 'verification':
      Object.assign(flat, { runs: verification.runs });
      break;
    case 'ingestion':
      Object.assign(flat, { sources: ingestion.sources });
      break;
  }
  return flat;
};

/**
 * Rewrite the oRPC `wiki.listWikis` response so anonymous callers only see
 * the featured demo wiki. The wire shape is the orpc v2 envelope
 * `{ json: { items, nextCursor? }, meta }`; we filter `json.items` in place
 * and rebuild the Response (preserving status + headers).
 */
const keepOnlyFeaturedWiki = async (response: Response): Promise<Response> => {
  const payload = (await response.clone().json()) as {
    json?: { items?: ReadonlyArray<{ id?: string }>; nextCursor?: string };
    meta?: unknown;
  };
  const items = (payload.json?.items ?? []).filter((w) => w.id === FEATURED_WIKI_ID);
  const rewritten = {
    ...payload,
    json: { ...(payload.json ?? {}), items, nextCursor: undefined },
  };
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(rewritten), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
