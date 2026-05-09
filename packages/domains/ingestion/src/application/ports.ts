import type { DriveFolder, Source as SourceWire } from '@package/contracts/ingestion';
import type { ContentHash, FolderId, SourceId, UserId } from '@package/contracts/shared';
import type { EventBus } from '@package/shared-kernel';
import type { Outline } from '../domain/outline.ts';
import type { Manifest, Source } from '../domain/source.ts';

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

export interface FetchedDriveFile {
  readonly manifest: Manifest;
  readonly bytes: Uint8Array;
}

export interface DriveConnector {
  startAuth(): Promise<DriveOAuthState>;
  completeAuth(args: { code: string; state: string }): Promise<DriveTokens>;
  listFolders(args: {
    parentId?: string;
    query?: string;
    limit: number;
  }): Promise<{ folders: DriveFolder[]; nextPageToken?: string }>;
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
  upsert(args: {
    folderId: FolderId;
    userId: UserId;
    driveFolderId: string;
    name: string;
  }): Promise<void>;
  findById(folderId: FolderId): Promise<FolderRecord | null>;
}

export interface OAuthRepository {
  saveTokens(args: {
    userId: UserId;
    refreshToken: string;
    accessToken: string;
    expiresAt: string;
  }): Promise<void>;
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
