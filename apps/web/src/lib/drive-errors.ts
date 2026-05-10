/**
 * Heuristic for "this error means the user hasn't completed Drive sign-in
 * yet" — used by Drive-aware components to swap their UI for a sign-in
 * CTA. The backend signals this state through a mix of typed oRPC errors
 * (401 / UNAUTHORIZED), a domain-level `OAuthTokenUnreadable`, and ad-hoc
 * messages from the Google connector when its token-refresh round-trip
 * fails. We match all three in one regex rather than trying to make the
 * backend emit a single discriminator: that would couple every reader to
 * a contract change.
 */
export const isDriveAuthError = (e: unknown): boolean => {
  const msg = (e as Error | undefined)?.message ?? '';
  return /NOT_AUTHENTICATED|UNAUTHORIZED|missing Drive token|drive_unauthorized|No Drive tokens|OAuthTokenUnreadable|401/i.test(
    msg,
  );
};

export const driveFolderIdFrom = (input: string): string => {
  const trimmed = input.trim();
  const m = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? trimmed;
};
