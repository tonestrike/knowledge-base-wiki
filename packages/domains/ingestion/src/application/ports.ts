import type { DriveFolder, Source as SourceWire } from '@package/contracts/ingestion';
import type { ContentHash, FolderId, SourceId, UserId } from '@package/contracts/shared';
import type { EventBus } from '@package/shared-kernel';
import type { Manifest } from '../domain/manifest.ts';
import type { Outline } from '../domain/outline.ts';
import type { Source } from '../domain/source.ts';

export interface DriveOAuthState {
  readonly state: string;
  readonly authorizationUrl: string;
}

export interface DriveTokens {
  readonly userId: UserId;
  readonly refreshToken: string;
  readonly accessToken: string;
  readonly expiresAt: string;
}

// Refreshed tokens — a refresh exchange produces a new access token (and a
// new expiry) but reuses the original refresh_token unless Google rotates it.
export interface RefreshedDriveTokens {
  readonly accessToken: string;
  readonly expiresAt: string;
  readonly refreshToken?: string;
}

export interface FetchedDriveFile {
  readonly manifest: Manifest;
  readonly bytes: Uint8Array;
}

export interface DriveFile {
  readonly driveFileId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly modifiedAt: string;
}

export interface DriveConnector {
  startAuth(): Promise<DriveOAuthState>;
  completeAuth(args: { code: string; state: string }): Promise<DriveTokens>;
  // `listFolders` returns sub-folders only (mimeType = vnd.google-apps.folder).
  // Use `listFiles` to enumerate the documents inside a folder.
  listFolders(args: {
    parentId?: string;
    query?: string;
    limit: number;
  }): Promise<{ folders: DriveFolder[]; nextPageToken?: string }>;
  // `listFiles` returns documents (everything that is NOT a folder) inside a
  // parent folder. The `ingestFolder` orchestrator feeds these IDs into
  // `fetch({ driveFileId })`. C1: previously the interface handler called
  // `listFolders` here, which only returned sub-folders, so against real
  // Drive every ingest returned `successful:0, failed:N`.
  listFiles(args: {
    parentId: string;
    limit: number;
    pageToken?: string;
  }): Promise<{ files: DriveFile[]; nextPageToken?: string }>;
  fetch(args: { driveFileId: string }): Promise<FetchedDriveFile>;
}

export interface SourceStorage {
  putRaw(args: {
    sourceId: SourceId;
    bytes: Uint8Array;
    contentHash: ContentHash;
  }): Promise<void>;
  putText(args: { sourceId: SourceId; text: string }): Promise<void>;
  putOutline(args: { sourceId: SourceId; outline: Outline }): Promise<void>;
  putPageImage(args: {
    sourceId: SourceId;
    pageNumber: number;
    png: Uint8Array;
  }): Promise<void>;
  getText(args: { sourceId: SourceId }): Promise<string | null>;
  getOutline(args: { sourceId: SourceId }): Promise<Outline | null>;
}

export interface SourceRepository {
  insert(source: Source): Promise<void>;
  findById(id: SourceId): Promise<Source | null>;
  findByDriveFileId(args: {
    folderId: FolderId;
    driveFileId: string;
  }): Promise<Source | null>;
  list(args: {
    folderId: FolderId;
    cursor?: string;
    limit: number;
  }): Promise<{ items: Source[]; nextCursor?: string }>;
  toWire(source: Source): SourceWire;
}

export interface FolderRecord {
  readonly id: FolderId;
  readonly userId: UserId;
  readonly driveFolderId: string;
  readonly name: string;
}

export interface FolderRepository {
  // I1: returns the persisted FolderId — which on re-register is the EXISTING
  // row's id, not the candidate id minted by the caller. Callers MUST use the
  // returned id when surfacing the result to clients.
  upsert(args: {
    folderId: FolderId;
    userId: UserId;
    driveFolderId: string;
    name: string;
  }): Promise<{ folderId: FolderId }>;
  findById(folderId: FolderId): Promise<FolderRecord | null>;
}

// SF2: typed error so the caller can surface "Re-connect Drive" guidance to
// the user instead of an opaque 500. Repos throw this when a stored token row
// exists but the AES-GCM cipher rejects the ciphertext (key rotated, db
// corrupted, etc.).
export class OAuthTokenUnreadable extends Error {
  readonly _tag = 'OAuthTokenUnreadable' as const;
  constructor(
    readonly userId: UserId,
    cause: unknown,
  ) {
    super(`OAuth token for user ${userId} could not be decrypted — re-connect Drive`);
    this.cause = cause;
  }
}

export interface OAuthRepository {
  saveTokens(args: {
    userId: UserId;
    refreshToken: string;
    accessToken: string;
    expiresAt: string;
  }): Promise<void>;
  // Throws `OAuthTokenUnreadable` (NOT a plain Error) when ciphertext decrypt
  // fails. Returns null only when the row genuinely doesn't exist.
  loadTokens(
    userId: UserId,
  ): Promise<{ refreshToken: string; accessToken: string; expiresAt: string } | null>;
}

export interface OAuthStateValue {
  readonly codeVerifier?: string;
  readonly createdAt: string;
}

export interface OAuthStateStore {
  set(state: string, value: OAuthStateValue): Promise<void>;
  consume(state: string): Promise<OAuthStateValue | null>;
}

export interface IngestionDeps {
  drive: DriveConnector;
  storage: SourceStorage;
  sources: SourceRepository;
  folders: FolderRepository;
  oauth: OAuthRepository;
  oauthState: OAuthStateStore;
  eventBus: EventBus;
  newId: () => string;
  now: () => Date;
}
