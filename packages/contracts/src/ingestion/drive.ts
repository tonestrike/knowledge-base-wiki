import { oc } from '@orpc/contract';
import { z } from 'zod';
import { FolderId, UserId } from '../shared/ids.ts';

export const DriveAuthStartInput = z.object({
  /**
   * Optional absolute URL the api should send the user back to after the
   * OAuth callback completes. The api validates this against an allowlist
   * before honouring it.
   */
  returnTo: z.string().url().optional(),
});
export type DriveAuthStartInput = z.infer<typeof DriveAuthStartInput>;

export const DriveAuthStartOutput = z.object({
  authorizationUrl: z.string().url(),
  state: z.string().min(16),
});

export const DriveAuthCallbackInput = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

export const DriveAuthCallbackOutput = z.object({
  userId: UserId,
  scopes: z.array(z.string()),
  /**
   * Absolute URL the api wants the caller to redirect to after the OAuth
   * exchange resolves. Captured from the `authStart` request's `returnTo`
   * and echoed through the OAuth state so the SPA at a different origin
   * (dev) or same origin (prod) lands on its home page. The Hono GET
   * handler in `apps/api/src/index.ts` validates this against an allowlist
   * before honouring it.
   */
  returnTo: z.string().url().optional(),
});

/**
 * Wire-shape of the signed session cookie payload. Encoded as JSON,
 * base64url-wrapped, and HMAC-signed by the api before being written to a
 * `tenex_sid` cookie at the end of the Drive OAuth callback. Defined in
 * the contract for documentation parity — the SPA never reads the cookie
 * directly (it's `HttpOnly`), but the typed shape pins what the api
 * commits to as the session contract.
 */
export const SessionCookiePayload = z.object({
  /** UserId the signed-in browser is acting as. */
  userId: UserId,
  /** Unix epoch milliseconds at which the cookie stops being valid. */
  expiresAt: z.number().int().positive(),
});
export type SessionCookiePayload = z.infer<typeof SessionCookiePayload>;

export const DriveFolder = z.object({
  driveFolderId: z.string().min(1),
  name: z.string().min(1),
  modifiedAt: z.string().datetime(),
});
export type DriveFolder = z.infer<typeof DriveFolder>;

export const ListDriveFoldersInput = z.object({
  parentId: z.string().min(1).optional(),
  query: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const ListDriveFoldersOutput = z.object({
  folders: z.array(DriveFolder),
  nextPageToken: z.string().optional(),
});

export const RegisterFolderInput = z.object({
  driveFolderId: z.string().min(1),
  name: z.string().min(1),
});

export const RegisterFolderOutput = z.object({
  folderId: FolderId,
});

export const driveContract = {
  authStart: oc
    .route({ method: 'POST', path: '/drive/auth/start' })
    .input(DriveAuthStartInput)
    .output(DriveAuthStartOutput),
  authCallback: oc
    .route({ method: 'POST', path: '/drive/auth/callback' })
    .input(DriveAuthCallbackInput)
    .output(DriveAuthCallbackOutput),
  listFolders: oc
    .route({ method: 'GET', path: '/drive/folders' })
    .input(ListDriveFoldersInput)
    .output(ListDriveFoldersOutput),
  registerFolder: oc
    .route({ method: 'POST', path: '/drive/folders' })
    .input(RegisterFolderInput)
    .output(RegisterFolderOutput),
};
