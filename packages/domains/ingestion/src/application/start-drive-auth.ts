import type { IngestionDeps } from './ports.ts';

export interface StartDriveAuthInput {
  /**
   * Optional absolute URL the api should send the user back to after the
   * OAuth callback completes. The api validates this against an allowlist
   * before honouring it; un-trusted hosts fall back to a default.
   */
  readonly returnTo?: string;
}

export interface StartDriveAuthOutput {
  readonly authorizationUrl: string;
  readonly state: string;
}

export async function startDriveAuth(
  deps: IngestionDeps,
  input: StartDriveAuthInput = {},
): Promise<StartDriveAuthOutput> {
  const { drive, oauthState, now } = deps;
  const { state, authorizationUrl } = await drive.startAuth();
  await oauthState.set(state, {
    createdAt: now().toISOString(),
    ...(input.returnTo !== undefined ? { returnTo: input.returnTo } : {}),
  });
  return { authorizationUrl, state };
}
