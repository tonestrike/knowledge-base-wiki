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
import { userId } from '@package/contracts/shared';
import { InMemoryEventBus, newId, systemClock } from '@package/shared-kernel';
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
import { mountSourceArtifacts } from './source-artifacts.ts';

// Drive OAuth credentials accept both `GOOGLE_OAUTH_*` and bare `GOOGLE_*`
// names; see `googleOAuthConfig` in `oauth-helpers.ts` for resolution order.
// `WEB_APP_ORIGINS` is the post-OAuth redirect allowlist (open-redirect
// prevention). `OAUTH_TOKEN_KEY_BASE64` is required in non-test envs;
// `resolveTokenKey` throws at boot when missing.
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
};

// Single-user demo: every signed-in identity collapses to this UserId.
// Multi-user comes later.
const DEMO_USER_ID = userId('99999999-2222-4333-8444-555555555555');

const buildIngestionContext = (env: Env): IngestionContext => {
  const cipher = createAesGcmCipher(resolveTokenKey(env));
  const oauth = createD1OAuthRepository(env.DB, cipher);

  // SF2: keep `OAuthTokenUnreadable` visible to the oRPC layer so handlers
  // return a typed 401 with a "Re-connect Drive" message, not a 500.
  const loadOrThrow = async (userIdValue: UserId) => {
    try {
      return await oauth.loadTokens(userIdValue);
    } catch (err) {
      if (err instanceof OAuthTokenUnreadable) throw err;
      throw err;
    }
  };

  // SF6/SF7: per-request access-token resolver. Honors `forceRefresh` after
  // a 401, and proactively refreshes when within REFRESH_SKEW_MS of expiry.
  const getCurrentAccessToken = async (opts: { forceRefresh?: boolean } = {}): Promise<string> => {
    const stored = await loadOrThrow(DEMO_USER_ID);
    if (!stored) throw new Error('No Drive tokens — call ingestion.authStart first.');
    const expiresAt = Date.parse(stored.expiresAt);
    const isExpiring = Number.isFinite(expiresAt) && expiresAt - Date.now() < REFRESH_SKEW_MS;
    if (!opts.forceRefresh && !isExpiring) {
      return stored.accessToken;
    }
    const refreshed = await refreshGoogleAccessToken(env, stored.refreshToken);
    await oauth.saveTokens({
      userId: DEMO_USER_ID,
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    });
    return refreshed.accessToken;
  };

  return {
    drive: (() => {
      const oauth = googleOAuthConfig(env);
      return createGoogleDriveConnector({
        clientId: oauth.clientId,
        clientSecret: oauth.clientSecret,
        redirectUri: oauth.redirectUri,
        resolveUserId: () => DEMO_USER_ID,
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
    currentUserId: DEMO_USER_ID,
  };
};

const app = new Hono<{ Bindings: Env }>();

app.use(
  '/rpc/*',
  cors({
    origin: (origin) => origin,
    credentials: true,
  }),
);

mountIngestionAuthCallback(app, buildIngestionContext);

// Each sub-router is bound to its own `$context<X>` type. RPCHandler can't
// unify those into a single nominal context, so we erase the router's type
// at construction. The per-handler `.handler(...)` callbacks still see
// their own typed context slice — only the multi-context spread at handle
// time is unsafe, and we control what we pass there.
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
let chatContextSingleton: ReturnType<typeof buildChatContext> | null = null;
const ensureChatContext = (env: Env) => {
  if (chatContextSingleton) return chatContextSingleton;
  chatContextSingleton = buildChatContext({
    eventBus: getSharedEventBus(),
    bindings: {
      db: env.DB,
      storage: env.STORAGE,
      openRouterApiKey: (env as unknown as { OPEN_ROUTER_API_KEY?: string }).OPEN_ROUTER_API_KEY,
    },
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

app.use('/rpc/*', async (c, next) => {
  // c.env is undefined when running under bun:test without executionContext;
  // we still want core/* routes to work in that case, so fall back to an
  // ENVIRONMENT=test stub. Ingestion routes will fail at use-time on missing
  // bindings, not here at construction time.
  const env = (c.env ?? { ENVIRONMENT: 'test' }) as Env;
  const ingestion = buildIngestionContext(env);
  bootstrapSubscriptions(env);
  const wiki = buildWikiContext(env, systemClock);
  const chatContext = ensureChatContext(env);
  const verification = buildVerificationContext(
    env as unknown as Parameters<typeof buildVerificationContext>[0],
    getSharedEventBus(),
    systemClock,
  );
  // Ports collide across contexts (wiki/chat/verification share `dispatcher`,
  // wiki/verification share `runs`, wiki/ingestion share `sources`). A single
  // spread lets the last writer silently win, so we pick precedence by
  // router slug. (Verification's dispatcher was renamed `lintDispatcher`
  // to avoid the collision entirely.)
  const url = new URL(c.req.raw.url);
  const slug = url.pathname.split('/')[2] ?? '';
  const flat = { ...wiki, ...ingestion, ...chatContext, ...verification, clock: systemClock };
  if (slug === 'wiki') {
    Object.assign(flat, { dispatcher: wiki.dispatcher, runs: wiki.runs, sources: wiki.sources });
  } else if (slug === 'chat') {
    // SF-CHAT-11: `waitUntil` keeps workerd alive for the chat dispatcher's
    // fire-and-forget research loop past the response flush.
    Object.assign(flat, {
      dispatcher: chatContext.dispatcher,
      waitUntil: c.executionCtx?.waitUntil
        ? (p: Promise<unknown>) => c.executionCtx.waitUntil(p)
        : undefined,
    });
  } else if (slug === 'verification') {
    Object.assign(flat, { runs: verification.runs });
  } else if (slug === 'ingestion') {
    Object.assign(flat, { sources: ingestion.sources });
  }

  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: '/rpc',
    // biome-ignore lint/suspicious/noExplicitAny: cross-context union, see comment above
    context: flat as any,
  });
  if (matched) {
    return c.newResponse(response.body, response);
  }
  await next();
});

app.get('/', (c) => c.text('tenex api'));

mountSourceArtifacts(app);
mountDevRoutes(app);

export { ChatTurnDO, CompileRunDO } from './durable-objects.ts';

export default app;
