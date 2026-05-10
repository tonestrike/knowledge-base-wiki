import {
  type SecretCipher,
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
import { type WikiBindings, buildWikiContext } from './build-wiki-deps.ts';
import { router } from './router.ts';

type Env = WikiBindings & {
  ENVIRONMENT: string;
  DB: D1Database;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT?: string;
  // SF1: required in every non-test environment. Boot-time check below throws
  // when missing so production never silently falls back to a zero key.
  OAUTH_TOKEN_KEY_BASE64: string;
};

// Single-user demo: every signed-in identity collapses to this UserId.
// Multi-user comes later.
const DEMO_USER_ID = userId('99999999-2222-4333-8444-555555555555');

// 32-byte zero key — only used as a fallback in the `test` environment so unit
// tests can construct a context without provisioning a real key. Production
// MUST set OAUTH_TOKEN_KEY_BASE64 via Infisical; the boot-time check below
// enforces this.
const ZERO_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const resolveTokenKey = (env: Env): string => {
  if (env.OAUTH_TOKEN_KEY_BASE64) return env.OAUTH_TOKEN_KEY_BASE64;
  if (env.ENVIRONMENT === 'test') return ZERO_KEY_BASE64;
  // SF1: fail loud at boot rather than silently encrypting/decrypting with a
  // zero key in production. The error message is what the operator sees in
  // logs / wrangler tail.
  throw new Error(
    'OAUTH_TOKEN_KEY_BASE64 is required in non-test environments. ' +
      'Set it via Infisical for the matching environment.',
  );
};

const createAesGcmCipher = (keyBase64: string): SecretCipher => {
  let cached: CryptoKey | null = null;
  const key = async (): Promise<CryptoKey> => {
    if (cached) return cached;
    cached = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0)),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
    return cached;
  };
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return {
    async encrypt(plaintext: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), enc.encode(plaintext)),
      );
      const out = new Uint8Array(iv.length + ct.length);
      out.set(iv);
      out.set(ct, iv.length);
      return btoa(String.fromCharCode(...out));
    },
    async decrypt(ciphertext: string) {
      const all = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
      const iv = all.slice(0, 12);
      const ct = all.slice(12);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await key(), ct);
      return dec.decode(pt);
    },
  };
};

// Refresh-token exchange against Google's token endpoint. Returns the new
// (accessToken, expiresAt) pair; Google rotates refresh_token only on revoke.
interface GoogleRefreshResponse {
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_token?: string;
}

const refreshGoogleAccessToken = async (
  env: Env,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string; refreshToken?: string }> => {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`google refresh-token exchange failed: ${res.status}`);
  }
  const j = (await res.json()) as GoogleRefreshResponse;
  return {
    accessToken: j.access_token,
    expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString(),
    refreshToken: j.refresh_token,
  };
};

// SF7: a tiny refresh threshold so we proactively swap the token before Drive
// returns 401. (Drive tokens last an hour; we refresh in the last minute.)
const REFRESH_SKEW_MS = 60_000;

const buildIngestionContext = (env: Env): IngestionContext => {
  const cipher = createAesGcmCipher(resolveTokenKey(env));
  const oauth = createD1OAuthRepository(env.DB, cipher);

  const loadOrThrow = async (userIdValue: UserId) => {
    try {
      return await oauth.loadTokens(userIdValue);
    } catch (err) {
      // SF2: keep the typed error visible to the caller. Surfacing
      // OAuthTokenUnreadable up to the oRPC layer lets the handler return a
      // typed 401 with a "Re-connect Drive" message, not an opaque 500.
      if (err instanceof OAuthTokenUnreadable) throw err;
      throw err;
    }
  };

  // Per-request access-token resolver: the connector calls this lazily, so
  // routers that don't need Drive (e.g. core/health) never touch D1.
  // SF6/SF7: honors `forceRefresh` after a 401, and proactively refreshes
  // when the stored token is within REFRESH_SKEW_MS of expiry.
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
    drive: createGoogleDriveConnector({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
      redirectUri: env.GOOGLE_OAUTH_REDIRECT ?? 'http://localhost:8787/rpc/ingestion/authCallback',
      resolveUserId: () => DEMO_USER_ID,
      getCurrentAccessToken,
    }),
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

app.use('/rpc/*', async (c, next) => {
  // c.env is undefined when running under bun:test without executionContext;
  // we still want core/* routes to work in that case, so fall back to an
  // ENVIRONMENT=test stub. Ingestion routes will fail at use-time on missing
  // bindings, not here at construction time.
  const env = (c.env ?? { ENVIRONMENT: 'test' }) as Env;
  const ingestion = buildIngestionContext(env);
  bootstrapSubscriptions(env);
  const wiki = buildWikiContext(env, systemClock);
  // Spread wiki BEFORE ingestion so a name collision (`sources`) resolves to
  // ingestion's SourceRepository (the wiki context never reads `sources`
  // through the oRPC handlers — only inside CompileRunDO, which builds its
  // own deps via `buildCompileRuntimeDeps`). The handler's type wants a
  // single context type but each sub-router is bound to its own; we union
  // them at runtime and cast — the per-handler `.handler` calls still
  // type-check the slice of context they read.
  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: '/rpc',
    context: {
      ...wiki,
      ...ingestion,
      clock: systemClock,
      // biome-ignore lint/suspicious/noExplicitAny: cross-context union, see comment above
    } as any,
  });
  if (matched) {
    return c.newResponse(response.body, response);
  }
  await next();
});

app.get('/', (c) => c.text('tenex api'));

export { CompileRunDO } from './durable-objects.ts';

export default app;
