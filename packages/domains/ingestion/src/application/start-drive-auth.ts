import type { IngestionDeps } from './ports.ts';

export interface StartDriveAuthOutput {
  readonly authorizationUrl: string;
  readonly state: string;
}

export async function startDriveAuth(deps: IngestionDeps): Promise<StartDriveAuthOutput> {
  const { drive, oauthState, now } = deps;
  const { state, authorizationUrl } = await drive.startAuth();
  await oauthState.set(state, { createdAt: now().toISOString() });
  return { authorizationUrl, state };
}
