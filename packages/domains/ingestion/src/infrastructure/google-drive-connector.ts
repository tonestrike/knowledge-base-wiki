import type { UserId } from '@package/contracts/shared';
import type { DriveConnector } from '../application/ports.ts';

export interface GoogleDriveConnectorConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  // Resolves a Drive identity (email) to our internal UserId.
  // For the single-user demo this is a constant; multi-user maps email → row.
  resolveUserId(driveProfileEmail: string): UserId;
  // Per-request access token resolver. The Worker context binds this from the
  // authenticated session; tests pass a stub. Returning null forces re-auth.
  getCurrentAccessToken(): Promise<string>;
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

interface DriveFileMetaResponse {
  readonly name: string;
  readonly mimeType: string;
  readonly size?: string;
  readonly modifiedTime: string;
}

const escapeDriveQuery = (raw: string): string => raw.replaceAll("'", "\\'");

export const createGoogleDriveConnector = (cfg: GoogleDriveConnectorConfig): DriveConnector => ({
  async startAuth() {
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
    const accessToken = await cfg.getCurrentAccessToken();
    const q = [
      "mimeType = 'application/vnd.google-apps.folder'",
      'trashed = false',
      parentId ? `'${escapeDriveQuery(parentId)}' in parents` : '',
      query ? `name contains '${escapeDriveQuery(query)}'` : '',
    ]
      .filter(Boolean)
      .join(' and ');
    const u = new URL('https://www.googleapis.com/drive/v3/files');
    u.searchParams.set('q', q);
    u.searchParams.set('fields', 'files(id,name,modifiedTime),nextPageToken');
    u.searchParams.set('pageSize', String(limit));
    const res = await fetch(u, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`drive listFolders ${res.status}`);
    }
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

  async fetch({ driveFileId }) {
    const accessToken = await cfg.getCurrentAccessToken();
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=id,name,mimeType,size,modifiedTime`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!metaRes.ok) {
      throw new Error(`drive metadata fetch ${metaRes.status}`);
    }
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
      ? `https://www.googleapis.com/drive/v3/files/${driveFileId}/export?mimeType=${encodeURIComponent(exportMime)}`
      : `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`;
    const res = await fetch(downloadUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`drive fetch ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Google-native files are exported to a different MIME than their source;
    // we record the original Google MIME so the extractor router picks the
    // right path. (The bytes themselves are text/plain or text/csv or PDF.)
    return {
      manifest: {
        driveFileId,
        filename: meta.name,
        mime: meta.mimeType as
          | 'application/pdf'
          | 'application/vnd.google-apps.document'
          | 'application/vnd.google-apps.spreadsheet'
          | 'application/vnd.google-apps.presentation'
          | 'text/plain'
          | 'text/markdown',
        sizeBytes: meta.size ? Number(meta.size) : bytes.length,
        modifiedAt: meta.modifiedTime,
      },
      bytes,
    };
  },
});
