import type { UserId } from '@package/contracts/shared';
import { isoTimestamp } from '@package/contracts/shared';
import type { DriveConnector } from '../application/ports.ts';
import { Manifest } from '../domain/manifest.ts';

export interface GoogleDriveConnectorConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  // Resolves a Drive identity (email) to our internal UserId.
  // For the single-user demo this is a constant; multi-user maps email → row.
  resolveUserId(driveProfileEmail: string): UserId;
  // Per-request access-token resolver. The Worker context binds this from the
  // authenticated session; tests pass a stub.
  //
  // SF6/SF7: the resolver MUST honor `forceRefresh=true` by exchanging the
  // stored refresh_token for a fresh access_token (and persisting it). The
  // connector calls with `forceRefresh=true` after a 401 and retries the
  // request once. The default-call path may also refresh proactively when
  // `expiresAt` is near.
  getCurrentAccessToken(opts?: { forceRefresh?: boolean }): Promise<string>;
}

interface DriveTokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
}

interface DriveProfileResponse {
  readonly email: string;
}

interface DriveFolderListResponse {
  readonly files: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly modifiedTime: string;
  }>;
  readonly nextPageToken?: string;
}

interface DriveFileListResponse {
  readonly files: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly mimeType: string;
    readonly modifiedTime: string;
  }>;
  readonly nextPageToken?: string;
}

interface DriveFileMetaResponse {
  readonly name: string;
  readonly mimeType: string;
  readonly size?: string;
  readonly modifiedTime: string;
}

const escapeDriveQuery = (raw: string): string => raw.replaceAll("'", "\\'");

// SF6: send Drive a request with bearer token; if it returns 401 (token
// expired/invalidated), refresh and retry exactly once. If it returns 429
// (quota), surface Retry-After in the error so the caller can back off
// instead of mis-classifying as a permanent failure.
const driveFetchWithRefresh = async (
  cfg: GoogleDriveConnectorConfig,
  build: (token: string) => { url: string | URL; init?: RequestInit },
  label: string,
): Promise<Response> => {
  let token = await cfg.getCurrentAccessToken();
  let { url, init } = build(token);
  let res = await fetch(url, withAuth(init, token));
  if (res.status === 401) {
    token = await cfg.getCurrentAccessToken({ forceRefresh: true });
    ({ url, init } = build(token));
    res = await fetch(url, withAuth(init, token));
  }
  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After') ?? '';
    throw new Error(`drive ${label} 429 quota — retry-after=${retryAfter}`);
  }
  if (!res.ok) {
    throw new Error(`drive ${label} ${res.status}`);
  }
  return res;
};

const withAuth = (init: RequestInit | undefined, token: string): RequestInit => ({
  ...(init ?? {}),
  headers: {
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
    authorization: `Bearer ${token}`,
  },
});

export const createGoogleDriveConnector = (cfg: GoogleDriveConnectorConfig): DriveConnector => ({
  async startAuth() {
    // Surface a typed error when no Google OAuth client id is configured —
    // otherwise we'd hand the user an authorizationUrl with `client_id=`
    // empty and Google would render its own 400 "Missing required
    // parameter: client_id" page, which the user has no way to recover
    // from inside our app. The api boundary accepts either
    // `GOOGLE_OAUTH_CLIENT_ID` or bare `GOOGLE_CLIENT_ID` as the secret
    // name (both shapes have been in use).
    if (!cfg.clientId) {
      throw new Error(
        'Drive OAuth is not configured: set GOOGLE_CLIENT_ID (or GOOGLE_OAUTH_CLIENT_ID) and the matching CLIENT_SECRET / REDIRECT in apps/api/.dev.vars (or via `wrangler secret put` for prod).',
      );
    }
    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      scope: 'https://www.googleapis.com/auth/drive.readonly profile email',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return {
      state,
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    };
  },

  async completeAuth({ code }) {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`google token exchange failed: ${tokenRes.status}`);
    }
    const t = (await tokenRes.json()) as DriveTokenResponse;
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { authorization: `Bearer ${t.access_token}` },
    });
    if (!profileRes.ok) {
      throw new Error(`google profile fetch failed: ${profileRes.status}`);
    }
    const profile = (await profileRes.json()) as DriveProfileResponse;
    return {
      userId: cfg.resolveUserId(profile.email),
      refreshToken: t.refresh_token,
      accessToken: t.access_token,
      expiresAt: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    };
  },

  async listFolders({ parentId, query, limit }) {
    const q = [
      "mimeType = 'application/vnd.google-apps.folder'",
      'trashed = false',
      parentId ? `'${escapeDriveQuery(parentId)}' in parents` : '',
      query ? `name contains '${escapeDriveQuery(query)}'` : '',
    ]
      .filter(Boolean)
      .join(' and ');
    const res = await driveFetchWithRefresh(
      cfg,
      () => {
        const u = new URL('https://www.googleapis.com/drive/v3/files');
        u.searchParams.set('q', q);
        u.searchParams.set('fields', 'files(id,name,modifiedTime),nextPageToken');
        u.searchParams.set('pageSize', String(limit));
        // Required so the response includes folders that live in Shared Drives
        // and folders the user has accessed via a public "Anyone with the link"
        // share. Without these the v3 API silently filters to My Drive only.
        u.searchParams.set('supportsAllDrives', 'true');
        u.searchParams.set('includeItemsFromAllDrives', 'true');
        return { url: u };
      },
      'listFolders',
    );
    const j = (await res.json()) as DriveFolderListResponse;
    return {
      folders: j.files.map((f) => ({
        driveFolderId: f.id,
        name: f.name,
        modifiedAt: f.modifiedTime,
      })),
      nextPageToken: j.nextPageToken,
    };
  },

  async listFiles({ parentId, limit, pageToken }) {
    // C1: complement to `listFolders` — returns NON-folder children of a parent.
    // This is what `ingestFolder` actually wants: documents to download.
    const q = [
      "mimeType != 'application/vnd.google-apps.folder'",
      'trashed = false',
      `'${escapeDriveQuery(parentId)}' in parents`,
    ].join(' and ');
    const res = await driveFetchWithRefresh(
      cfg,
      () => {
        const u = new URL('https://www.googleapis.com/drive/v3/files');
        u.searchParams.set('q', q);
        u.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime),nextPageToken');
        u.searchParams.set('pageSize', String(limit));
        if (pageToken) u.searchParams.set('pageToken', pageToken);
        // Same as listFolders: include items from Shared Drives + folders
        // shared with "Anyone with the link". Without this a public folder
        // returns zero files even though the user can see them in the UI.
        u.searchParams.set('supportsAllDrives', 'true');
        u.searchParams.set('includeItemsFromAllDrives', 'true');
        return { url: u };
      },
      'listFiles',
    );
    const j = (await res.json()) as DriveFileListResponse;
    return {
      files: j.files.map((f) => ({
        driveFileId: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedAt: f.modifiedTime,
      })),
      nextPageToken: j.nextPageToken,
    };
  },

  async fetch({ driveFileId }) {
    const metaRes = await driveFetchWithRefresh(
      cfg,
      () => ({
        // supportsAllDrives lets metadata.get + the download URL resolve files
        // that live in Shared Drives or folders shared publicly via link.
        url: `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=id,name,mimeType,size,modifiedTime&supportsAllDrives=true`,
      }),
      'metadata',
    );
    const meta = (await metaRes.json()) as DriveFileMetaResponse;
    const isGoogleNative = meta.mimeType.startsWith('application/vnd.google-apps.');
    const exportMime = isGoogleNative
      ? meta.mimeType === 'application/vnd.google-apps.document'
        ? 'text/plain'
        : meta.mimeType === 'application/vnd.google-apps.spreadsheet'
          ? 'text/csv'
          : 'application/pdf'
      : null;
    const downloadUrl = exportMime
      ? `https://www.googleapis.com/drive/v3/files/${driveFileId}/export?mimeType=${encodeURIComponent(exportMime)}&supportsAllDrives=true`
      : `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media&supportsAllDrives=true`;
    const res = await driveFetchWithRefresh(cfg, () => ({ url: downloadUrl }), 'fetch');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Google-native files are exported to a different MIME than their source;
    // we record the original Google MIME so the extractor router picks the
    // right path. (The bytes themselves are text/plain or text/csv or PDF.)
    //
    // Some Drive uploads arrive with a non-standard markdown MIME — Drive sets
    // `text/x-markdown` for .md files uploaded via the web UI prior to ~2024.
    // Normalize to `text/markdown` so the extractor router only has to handle
    // one variant.
    const rawMime = meta.mimeType === 'text/x-markdown' ? 'text/markdown' : meta.mimeType;
    const manifest = Manifest.create({
      driveFileId,
      filename: meta.name,
      mime: rawMime as
        | 'application/pdf'
        | 'application/vnd.google-apps.document'
        | 'application/vnd.google-apps.spreadsheet'
        | 'application/vnd.google-apps.presentation'
        | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        | 'text/plain'
        | 'text/markdown',
      sizeBytes: meta.size ? Number(meta.size) : bytes.length,
      modifiedAt: isoTimestamp(meta.modifiedTime),
    });
    return { manifest, bytes };
  },
});
