import type { UserId } from '@package/contracts/shared';
import { userId as parseUserId } from '@package/contracts/shared';

// Session-scoped Drive auth.
//
// Each visitor gets a signed cookie carrying (userId, expiresAt). The cookie
// is set at the end of the Google OAuth callback (after `completeDriveAuth`
// resolves a UserId) and verified on every `/rpc/*` request before any
// handler runs.
//
// Cookie shape:    `tenex_sid=<base64url(payload)>.<hmacHex>`
// Payload:         JSON `{ "u": "<userId>", "e": <unix-ms> }`
// Signature:       HMAC-SHA256 over the base64url(payload) using
//                  SESSION_SIGNING_KEY (32 random bytes, base64). The
//                  signature is hex-encoded so the cookie value is
//                  cookie-safe without further escaping.
//
// We hand-roll this because every dependency we'd otherwise reach for
// (iron-webcrypto, hono/jwt, jose) drags in either Node primitives that
// don't run on Workers without polyfills, or a bundle large enough to push
// the worker over its size budget for what is — fundamentally — eight
// lines of HMAC.

export const SESSION_COOKIE_NAME = 'tenex_sid';
// 14 days, matches the spec. Drive refresh tokens last indefinitely (Google
// rotates only on revoke); the cookie expiry just bounds how long a single
// browser session is good for before we force a re-sign-in.
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  readonly userId: UserId;
  readonly expiresAt: number;
}

// Fixed user id used only when `ENVIRONMENT === 'test'`. Lets unit tests
// against `app.fetch(...)` exercise authenticated routes without provisioning
// a signing key or running a full OAuth flow.
export const TEST_USER_ID = parseUserId('99999999-2222-4333-8444-555555555555');

const enc = new TextEncoder();
const dec = new TextDecoder();

const base64UrlEncode = (bytes: Uint8Array | string): string => {
  const buf = typeof bytes === 'string' ? enc.encode(bytes) : bytes;
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

const hexEncode = (bytes: Uint8Array): string => {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
};

const importKey = async (signingKeyBase64: string): Promise<CryptoKey> => {
  // The signing key is base64-encoded 32 random bytes. We import as a raw
  // HMAC-SHA-256 key — Web Crypto handles the HMAC inner/outer padding.
  const raw = Uint8Array.from(atob(signingKeyBase64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
};

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export interface SignSessionInput {
  readonly userId: UserId;
  readonly signingKeyBase64: string;
  readonly now?: () => Date;
  readonly ttlMs?: number;
}

/**
 * Mint a fresh signed session string. Caller serializes into a `Set-Cookie`
 * header with the security attributes documented in `buildSetCookieHeader`.
 */
export const signSession = async (input: SignSessionInput): Promise<string> => {
  const now = (input.now ?? (() => new Date()))();
  const expiresAt = now.getTime() + (input.ttlMs ?? SESSION_TTL_MS);
  const payload: SessionPayload = { userId: input.userId, expiresAt };
  const payloadB64 = base64UrlEncode(JSON.stringify({ u: payload.userId, e: payload.expiresAt }));
  const key = await importKey(input.signingKeyBase64);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64)));
  return `${payloadB64}.${hexEncode(sig)}`;
};

export interface VerifySessionInput {
  readonly cookieValue: string;
  readonly signingKeyBase64: string;
  readonly now?: () => Date;
}

/**
 * Verify a signed session. Returns the payload when the HMAC matches AND the
 * expiry is in the future; returns `null` otherwise (no exceptions on the
 * happy "user just isn't signed in" path — a missing/forged/expired cookie
 * all collapse to "no session").
 */
export const verifySession = async (input: VerifySessionInput): Promise<SessionPayload | null> => {
  const parts = input.cookieValue.split('.');
  if (parts.length !== 2) return null;
  const payloadB64 = parts[0];
  const sigHex = parts[1];
  if (!payloadB64 || !sigHex) return null;
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = base64UrlDecode(payloadB64);
  } catch {
    return null;
  }
  let key: CryptoKey;
  try {
    key = await importKey(input.signingKeyBase64);
  } catch {
    return null;
  }
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64)));
  if (!constantTimeEqual(hexEncode(expected), sigHex)) return null;
  let parsed: { u?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(dec.decode(payloadBytes)) as { u?: unknown; e?: unknown };
  } catch {
    return null;
  }
  if (typeof parsed.u !== 'string' || typeof parsed.e !== 'number') return null;
  const now = (input.now ?? (() => new Date()))().getTime();
  if (parsed.e <= now) return null;
  let uid: UserId;
  try {
    uid = parseUserId(parsed.u);
  } catch {
    return null;
  }
  return { userId: uid, expiresAt: parsed.e };
};

/**
 * Parse a raw `Cookie` header and pull out the named cookie's value.
 * Returns `null` when the header is absent or doesn't carry the cookie.
 */
export const readCookie = (cookieHeader: string | null, name: string): string | null => {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
};

/**
 * Build the `Set-Cookie` header value for a fresh session. `HttpOnly`
 * blocks JS access; `Secure` requires HTTPS in prod (Workers always serves
 * HTTPS); `SameSite=Lax` permits the Google OAuth 302 to land on us with
 * the cookie attached on first sight; `Path=/` covers both `/rpc/*` and
 * the SPA root.
 *
 * `secure` is parameterized so unit tests against `http://localhost`
 * harnesses can opt out — production callers always pass `secure: true`.
 */
export const buildSetCookieHeader = (args: {
  value: string;
  ttlMs?: number;
  secure?: boolean;
}): string => {
  const maxAge = Math.floor((args.ttlMs ?? SESSION_TTL_MS) / 1000);
  const secure = args.secure ?? true;
  const attrs = [
    `${SESSION_COOKIE_NAME}=${args.value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
};

export interface ResolveSessionInput {
  readonly cookieHeader: string | null;
  readonly signingKeyBase64?: string;
  readonly environment?: string;
  readonly now?: () => Date;
}

/**
 * Top-level "what user is this request?" resolver used by the Hono
 * middleware. Encodes the test-environment bypass in one place so the
 * happy and bypass paths can't drift apart.
 *
 * Behaviour:
 * - `environment === 'test'` → return `TEST_USER_ID` unconditionally (no
 *   cookie, no signing key required). Lets `router.test.ts` and friends
 *   exercise authenticated routes without provisioning HMAC material.
 * - otherwise → require a signing key, verify the cookie, return its
 *   userId on success or `null` on any failure (missing cookie, bad
 *   signature, expired, malformed payload).
 */
export const resolveSession = async (input: ResolveSessionInput): Promise<UserId | null> => {
  if (input.environment === 'test') return TEST_USER_ID;
  if (!input.signingKeyBase64) return null;
  const cookieValue = readCookie(input.cookieHeader, SESSION_COOKIE_NAME);
  if (!cookieValue) return null;
  const verified = await verifySession({
    cookieValue,
    signingKeyBase64: input.signingKeyBase64,
    ...(input.now ? { now: input.now } : {}),
  });
  return verified?.userId ?? null;
};
