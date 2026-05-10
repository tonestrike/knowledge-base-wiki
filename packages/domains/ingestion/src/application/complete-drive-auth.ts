import type { UserId } from '@package/contracts/shared';
import type { IngestionDeps } from './ports.ts';

export interface CompleteDriveAuthInput {
  readonly code: string;
  readonly state: string;
}

export interface CompleteDriveAuthOutput {
  readonly userId: UserId;
  readonly scopes: string[];
  /**
   * Echoed back from the OAuth state record so the api shell knows where
   * to send the user after a successful callback. The state record was
   * written at `authStart` time with the originating browser's origin.
   */
  readonly returnTo?: string;
}

export async function completeDriveAuth(
  deps: IngestionDeps,
  input: CompleteDriveAuthInput,
): Promise<CompleteDriveAuthOutput> {
  const { drive, oauthState, oauth } = deps;
  const stored = await oauthState.consume(input.state);
  if (!stored) throw new Error('unknown or expired oauth state');
  const tokens = await drive.completeAuth(input);
  await oauth.saveTokens({
    userId: tokens.userId,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
  });
  return {
    userId: tokens.userId,
    scopes: ['drive.readonly'],
    ...(stored.returnTo !== undefined ? { returnTo: stored.returnTo } : {}),
  };
}
