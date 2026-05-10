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
import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { userId } from '@package/contracts/shared';
import { InMemoryEventBus, newId, systemClock } from '@package/shared-kernel';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { router } from './router.ts';

interface Env {
  ENVIRONMENT: string;
  DB: D1Database;
  CACHE: KVNamespace;
  STORAGE: R2Bucket;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT?: string;
  OAUTH_TOKEN_KEY_BASE64?: string;
}

// Single-user demo: every signed-in identity collapses to this UserId.
// Multi-user comes later.
const DEMO_USER_ID = userId('99999999-2222-4333-8444-555555555555');

// 32-byte zero key — only used as a fallback when OAUTH_TOKEN_KEY_BASE64 is
// missing (e.g. in unit tests or before secrets are provisioned). Real
// deployments MUST set OAUTH_TOKEN_KEY_BASE64 via Infisical.
const ZERO_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

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

const buildIngestionContext = (env: Env): IngestionContext => {
  const cipher = createAesGcmCipher(env.OAUTH_TOKEN_KEY_BASE64 ?? ZERO_KEY_BASE64);
  const oauth = createD1OAuthRepository(env.DB, cipher);
  // Per-request access-token resolver: the connector calls this lazily, so
  // routers that don't need Drive (e.g. core/health) never touch D1.
  const getCurrentAccessToken = async (): Promise<string> => {
    const t = await oauth.loadTokens(DEMO_USER_ID);
    if (!t) throw new Error('No Drive tokens — call ingestion.authStart first.');
    return t.accessToken;
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

const handler = new RPCHandler(router, {
  interceptors: [
    onError((error) => {
      console.error('[orpc]', error);
    }),
  ],
});

app.use('/rpc/*', async (c, next) => {
  // c.env is undefined when running under bun:test without executionContext;
  // we still want core/* routes to work in that case, so fall back to an
  // empty record. Ingestion routes will fail at use-time on missing bindings,
  // not here at construction time.
  const ingestion = buildIngestionContext(c.env ?? ({} as Env));
  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: '/rpc',
    // Spread the ingestion context first; `clock` is included from there. We
    // keep clock spelled out below for routers that haven't migrated yet.
    context: {
      ...ingestion,
    },
  });
  if (matched) {
    return c.newResponse(response.body, response);
  }
  await next();
});

app.get('/', (c) => c.text('tenex api'));

export default app;
