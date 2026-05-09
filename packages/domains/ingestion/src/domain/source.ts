import type { ContentHash, FolderId, SourceId } from '@package/contracts/shared';

export type SourceMime =
  | 'application/pdf'
  | 'application/vnd.google-apps.document'
  | 'application/vnd.google-apps.spreadsheet'
  | 'application/vnd.google-apps.presentation'
  | 'text/plain'
  | 'text/markdown';

export interface Manifest {
  readonly driveFileId: string;
  readonly filename: string;
  readonly mime: SourceMime;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
  readonly pageCount?: number;
}

export interface Source {
  readonly id: SourceId;
  readonly folderId: FolderId;
  readonly manifest: Manifest;
  readonly contentHash: ContentHash;
  readonly fetchedAt: string;
}

export interface SourceCreateProps {
  readonly id: SourceId;
  readonly folderId: FolderId;
  readonly manifest: Manifest;
  readonly contentHash: ContentHash;
  readonly fetchedAt: string;
}

// Source is an immutable aggregate root. Identity is rooted in (id, contentHash).
// If the underlying Drive file's bytes change, callers MUST mint a new Source —
// never mutate. This is enforced at the type level (readonly) and at runtime
// via Object.freeze on both the Source and its Manifest.
export const Source = {
  create(props: SourceCreateProps): Source {
    const manifest: Manifest = Object.freeze({ ...props.manifest });
    return Object.freeze({
      id: props.id,
      folderId: props.folderId,
      manifest,
      contentHash: props.contentHash,
      fetchedAt: props.fetchedAt,
    });
  },
};

// A fingerprint that disambiguates two Sources for the same Drive file id.
// Two Sources fetched at different times with different bytes will fingerprint
// differently; two Sources for the same bytes (re-fetched) fingerprint identically.
export const sourceFingerprint = (s: Source): string =>
  `${s.manifest.driveFileId}:${s.contentHash}`;
