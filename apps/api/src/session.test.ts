import { describe, expect, it } from 'bun:test';
import { userId } from '@package/contracts/shared';
import {
  SESSION_COOKIE_NAME,
  TEST_USER_ID,
  buildSetCookieHeader,
  readCookie,
  resolveSession,
  signSession,
  verifySession,
} from './session.ts';

// 32 zero bytes — only ever used inside this test file. Production reads a
// real random key from `SESSION_SIGNING_KEY` (see `.dev.vars.example`).
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const OTHER_KEY = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';

const UID = userId('11111111-2222-4333-8444-aaaaaaaaaaaa');

describe('signSession / verifySession', () => {
  it('round-trips a freshly signed session and recovers the user id', async () => {
    const cookie = await signSession({ userId: UID, signingKeyBase64: KEY });
    const verified = await verifySession({ cookieValue: cookie, signingKeyBase64: KEY });
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe(UID);
    expect(typeof verified?.expiresAt).toBe('number');
    expect(verified?.expiresAt ?? 0).toBeGreaterThan(Date.now());
  });

  it('refuses a cookie signed with a different key (forged HMAC)', async () => {
    const cookie = await signSession({ userId: UID, signingKeyBase64: KEY });
    const verified = await verifySession({
      cookieValue: cookie,
      signingKeyBase64: OTHER_KEY,
    });
    expect(verified).toBeNull();
  });

  it('refuses a cookie whose payload was tampered with after signing', async () => {
    const cookie = await signSession({ userId: UID, signingKeyBase64: KEY });
    const parts = cookie.split('.');
    const tampered = `${parts[0]}A.${parts[1]}`;
    const verified = await verifySession({
      cookieValue: tampered,
      signingKeyBase64: KEY,
    });
    expect(verified).toBeNull();
  });

  it('refuses a malformed cookie (missing dot separator)', async () => {
    const verified = await verifySession({
      cookieValue: 'not-a-real-session',
      signingKeyBase64: KEY,
    });
    expect(verified).toBeNull();
  });

  it('refuses an expired cookie', async () => {
    // Sign with a 1-ms TTL so the cookie is stale by the time we verify it.
    const cookie = await signSession({ userId: UID, signingKeyBase64: KEY, ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const verified = await verifySession({ cookieValue: cookie, signingKeyBase64: KEY });
    expect(verified).toBeNull();
  });
});

describe('readCookie', () => {
  it('returns the value of the named cookie', () => {
    expect(readCookie('a=1; tenex_sid=abc.def; b=2', SESSION_COOKIE_NAME)).toBe('abc.def');
  });

  it('returns null when the cookie header is missing', () => {
    expect(readCookie(null, SESSION_COOKIE_NAME)).toBeNull();
  });

  it('returns null when the named cookie is not present', () => {
    expect(readCookie('a=1; b=2', SESSION_COOKIE_NAME)).toBeNull();
  });
});

describe('buildSetCookieHeader', () => {
  it('emits HttpOnly, Secure, SameSite=Lax, Path=/, and Max-Age', () => {
    const header = buildSetCookieHeader({ value: 'abc.def', ttlMs: 60_000 });
    expect(header).toContain(`${SESSION_COOKIE_NAME}=abc.def`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=60');
    expect(header).toContain('Secure');
  });

  it('omits Secure when the caller opts out (for local http test harnesses)', () => {
    const header = buildSetCookieHeader({ value: 'abc.def', secure: false });
    expect(header).not.toContain('Secure');
  });
});

describe('resolveSession', () => {
  it('returns the fixed TEST_USER_ID under ENVIRONMENT=test without inspecting the cookie', async () => {
    const uid = await resolveSession({ cookieHeader: null, environment: 'test' });
    expect(uid).toBe(TEST_USER_ID);
  });

  it('returns the user id from a valid signed cookie', async () => {
    const cookie = await signSession({ userId: UID, signingKeyBase64: KEY });
    const uid = await resolveSession({
      cookieHeader: `${SESSION_COOKIE_NAME}=${cookie}`,
      signingKeyBase64: KEY,
      environment: 'production',
    });
    expect(uid).toBe(UID);
  });

  it('returns null with no cookie outside the test env', async () => {
    const uid = await resolveSession({
      cookieHeader: null,
      signingKeyBase64: KEY,
      environment: 'production',
    });
    expect(uid).toBeNull();
  });

  it('returns null with a forged cookie outside the test env', async () => {
    const cookie = await signSession({ userId: UID, signingKeyBase64: KEY });
    const uid = await resolveSession({
      cookieHeader: `${SESSION_COOKIE_NAME}=${cookie}`,
      signingKeyBase64: OTHER_KEY,
      environment: 'production',
    });
    expect(uid).toBeNull();
  });

  it('returns null when SESSION_SIGNING_KEY is missing outside the test env', async () => {
    const uid = await resolveSession({
      cookieHeader: `${SESSION_COOKIE_NAME}=anything`,
      environment: 'production',
    });
    expect(uid).toBeNull();
  });
});
