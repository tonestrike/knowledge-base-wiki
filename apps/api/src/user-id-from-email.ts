import type { UserId } from '@package/contracts/shared';
import { userId as parseUserId } from '@package/contracts/shared';

/**
 * Derive a stable UserId from a Google profile email.
 *
 * Each Drive sign-in resolves to the same row in `oauth_tokens` and
 * `folders.user_id` without us needing a separate users table — the email is
 * the natural identity for a single-tenant demo. We can't use SHA-256 here
 * (the connector's `resolveUserId` is synchronous and `crypto.subtle.digest`
 * is async), so we hash with FNV-1a, expand the 64 bits into a 128-bit
 * pseudo-state, and format the result as a v4 UUID (forcing the version and
 * variant nibbles so the `UserId` brand validator accepts it).
 *
 * FNV-1a is fine here: the function maps one or two emails total in the
 * demo, and the result is private to this Worker — collisions or
 * predictability aren't security-relevant.
 */
export const userIdFromDriveEmail = (email: string): UserId => {
  const normalized = (email ?? '').toLowerCase();
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < normalized.length; i += 1) {
    const c = normalized.charCodeAt(i);
    h1 = ((h1 ^ c) * 16777619) >>> 0;
    h2 = ((h2 ^ c) * 2246822519) >>> 0;
  }
  const hex = (n: number): string => n.toString(16).padStart(8, '0');
  const raw = `${hex(h1)}${hex(h2)}${hex(h1 ^ 0xa5a5a5a5)}${hex(h2 ^ 0x5a5a5a5a)}`;
  const formatted =
    `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-` +
    `8${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
  return parseUserId(formatted);
};
