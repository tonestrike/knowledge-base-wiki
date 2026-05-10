import type { UserId } from '@package/contracts/shared';
import type { OAuthRepository } from '../application/ports.ts';
import { OAuthTokenUnreadable } from '../application/ports.ts';
import type { D1DatabaseLike } from './cloudflare-bindings.ts';

export interface SecretCipher {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

interface TokenRow {
  readonly encrypted_refresh_token: string;
  readonly encrypted_access_token: string;
  readonly expires_at: string;
}

export const createD1OAuthRepository = (
  db: D1DatabaseLike,
  cipher: SecretCipher,
): OAuthRepository => ({
  async saveTokens({ userId, refreshToken, accessToken, expiresAt }) {
    const er = await cipher.encrypt(refreshToken);
    const ea = await cipher.encrypt(accessToken);
    await db
      .prepare(
        "INSERT INTO oauth_tokens (user_id, provider, encrypted_refresh_token, encrypted_access_token, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token, encrypted_access_token=excluded.encrypted_access_token, expires_at=excluded.expires_at, updated_at=datetime('now')",
      )
      .bind(userId, 'google', er, ea, expiresAt)
      .run();
  },
  async loadTokens(userId: UserId) {
    const r = await db
      .prepare(
        'SELECT encrypted_refresh_token, encrypted_access_token, expires_at FROM oauth_tokens WHERE user_id = ?',
      )
      .bind(userId)
      .first<TokenRow>();
    if (!r) return null;
    // SF2: classify decrypt failure separately from "no row". A decrypt fail
    // means the row exists but the cipher rejects it (key rotation, db
    // corruption, AAD mismatch). Re-auth is the recovery; opaque 500s aren't.
    try {
      const refreshToken = await cipher.decrypt(r.encrypted_refresh_token);
      const accessToken = await cipher.decrypt(r.encrypted_access_token);
      return { refreshToken, accessToken, expiresAt: r.expires_at };
    } catch (err) {
      console.error('[oauth] decrypt failed for user', userId, err);
      throw new OAuthTokenUnreadable(userId, err);
    }
  },
});
