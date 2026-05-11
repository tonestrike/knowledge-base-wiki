import { completeDriveAuth } from '@domain/ingestion';
import type { SecretCipher } from '@domain/ingestion/infrastructure';
import type { IngestionContext } from '@domain/ingestion/interface';
import type { UserId } from '@package/contracts/shared';
import type { Hono } from 'hono';

/**
 * Narrow env shape consumed by the OAuth helpers. Worker `Env` in `index.ts`
 * is a structural superset of this; passing it here is intentional so this
 * module has no dependency on the full env definition (and therefore no
 * dependency on every binding the api wires up).
 */
export interface OAuthEnv {
  ENVIRONMENT: string;
  OAUTH_TOKEN_KEY_BASE64?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT?: string;
}

/**
 * Resolve the Drive OAuth credentials from the Worker env, accepting either
 * the `GOOGLE_OAUTH_*` or bare `GOOGLE_*` secret names. Both shapes have been
 * in use historically; the chat / drive flow only cares that *some* matching
 * trio is present.
 */
export const googleOAuthConfig = (
  env: OAuthEnv,
): { clientId: string; clientSecret: string; redirectUri: string } => ({
  clientId: env.GOOGLE_OAUTH_CLIENT_ID ?? env.GOOGLE_CLIENT_ID ?? '',
  clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? env.GOOGLE_CLIENT_SECRET ?? '',
  redirectUri:
    env.GOOGLE_OAUTH_REDIRECT ??
    env.GOOGLE_REDIRECT ??
    'http://localhost:8787/rpc/ingestion/authCallback',
});

// 32-byte zero key — only used as a fallback in the `test` environment so unit
// tests can construct a context without provisioning a real key. Production
// MUST set OAUTH_TOKEN_KEY_BASE64 (via .dev.vars locally or `wrangler secret`
// in prod); the boot-time check below enforces this.
export const ZERO_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export const resolveTokenKey = (env: OAuthEnv): string => {
  if (env.OAUTH_TOKEN_KEY_BASE64) return env.OAUTH_TOKEN_KEY_BASE64;
  if (env.ENVIRONMENT === 'test') return ZERO_KEY_BASE64;
  // SF1: fail loud at boot rather than silently encrypting/decrypting with a
  // zero key in production. The error message is what the operator sees in
  // logs / wrangler tail.
  throw new Error(
    'OAUTH_TOKEN_KEY_BASE64 is required in non-test environments. ' +
      'Set it in apps/api/.dev.vars locally, or via `wrangler secret put` for prod. ' +
      'Generate a fresh key with: openssl rand -base64 32',
  );
};

export const createAesGcmCipher = (keyBase64: string): SecretCipher => {
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

export const refreshGoogleAccessToken = async (
  env: OAuthEnv,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: string; refreshToken?: string }> => {
  const oauth = googleOAuthConfig(env);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
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
export const REFRESH_SKEW_MS = 60_000;

/**
 * Resolve the post-OAuth redirect target. The caller-provided `returnTo`
 * (echoed from the OAuth state) is honoured only if its origin matches an
 * entry in `WEB_APP_ORIGINS` (comma-separated env). Falls back to the
 * first allowlisted origin, then to `/` (works for single-origin prod
 * where the Worker serves both `/rpc/*` and the SPA).
 */
export const resolveRedirect = (
  env: { WEB_APP_ORIGINS?: string },
  returnTo: string | undefined,
  requestUrl: string,
): string => {
  const allow = (env.WEB_APP_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // The request's own origin is always allowlisted: in production the
  // Worker serves the SPA from this origin, so a `returnTo` that matches
  // it can never be a vector to anywhere else.
  try {
    allow.push(new URL(requestUrl).origin);
  } catch {
    /* ignore — env.WEB_APP_ORIGINS still applies */
  }
  if (returnTo) {
    try {
      const u = new URL(returnTo);
      if (allow.includes(u.origin)) return returnTo;
      console.warn('[ingestion.authCallback.GET] returnTo origin not in allowlist', {
        origin: u.origin,
      });
    } catch {
      /* malformed returnTo → fall through */
    }
  }
  // Default to "?drive=connected" on the first allowlisted origin so the
  // root route knows the user just completed sign-in.
  if (allow.length > 0) return `${allow[0]}/?drive=connected`;
  return '/?drive=connected';
};

export interface AuthCallbackDeps<Env extends OAuthEnv & { WEB_APP_ORIGINS?: string }> {
  /**
   * Build an ingestion context bound to a specific UserId — or to `null`
   * when called from the OAuth callback (the userId only exists AFTER
   * `completeDriveAuth` resolves it, so the connector falls back to
   * email-derived id minting for the first sign-in).
   */
  readonly buildIngestionContext: (env: Env, currentUserId: UserId | null) => IngestionContext;
  /**
   * Mint a `Set-Cookie` header value pinning the browser to `userId`.
   * Return `null` to skip the header (e.g. when no signing key is
   * configured in a test environment).
   */
  readonly mintSessionCookie?: (env: Env, userId: UserId) => Promise<string | null>;
}

/**
 * Register the Google OAuth callback. Must be mounted BEFORE the `/rpc/*`
 * oRPC dispatcher: the contract defines `ingestion.authCallback` as POST
 * (typed RPC clients send the code/state in the body), but Google
 * redirects the user-agent here with a GET carrying `?code=...&state=...`.
 * Without this Hono GET, the dispatcher matches the path, sees the wrong
 * method, and returns 405.
 *
 * After `completeDriveAuth` resolves a `UserId`, the optional
 * `mintSessionCookie` dependency turns that id into a signed cookie value
 * which we set on the 302 response — that's how the browser carries the
 * session on subsequent `/rpc/*` calls. Everything to do with HMAC and
 * cookie attributes lives in `session.ts`; this module is intentionally
 * unaware of those internals.
 */
export const mountIngestionAuthCallback = <Env extends OAuthEnv & { WEB_APP_ORIGINS?: string }>(
  // biome-ignore lint/suspicious/noExplicitAny: app is generic over its Bindings
  app: Hono<any>,
  deps: AuthCallbackDeps<Env>,
): void => {
  app.get('/rpc/ingestion/authCallback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    if (!code || !state) {
      return c.text('Missing code or state in Google callback.', 400);
    }
    try {
      const env = c.env as Env;
      // Pre-OAuth: no userId yet, so build ingestion with `null` and let
      // the connector mint a stable id from the Google profile email.
      const ingestion = deps.buildIngestionContext(env, null);
      const result = await completeDriveAuth(ingestion, { code, state });
      const target = resolveRedirect(env, result.returnTo, c.req.url);
      const setCookie = (await deps.mintSessionCookie?.(env, result.userId)) ?? null;
      if (setCookie) c.header('Set-Cookie', setCookie);
      return c.redirect(target, 302);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Drive OAuth callback failed.';
      console.error('[ingestion.authCallback.GET] failed', { err: message });
      return c.text(`Drive sign-in failed: ${message}`, 400);
    }
  });
};
