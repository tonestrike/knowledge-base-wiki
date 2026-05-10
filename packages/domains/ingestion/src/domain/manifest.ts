import type { IsoTimestamp } from '@package/contracts/shared';

export type SourceMime =
  | 'application/pdf'
  | 'application/vnd.google-apps.document'
  | 'application/vnd.google-apps.spreadsheet'
  | 'application/vnd.google-apps.presentation'
  | 'text/plain'
  | 'text/markdown';

// Manifest is the metadata-only value object for a `Source`'s underlying
// Drive file. Identity-bearing fields (id, contentHash, fetchedAt) live on
// `Source`; mutable-by-Drive fields (filename, modifiedAt, sizeBytes) live
// here. Frozen at construction so callers can't mutate post-create.
export interface Manifest {
  readonly driveFileId: string;
  readonly filename: string;
  readonly mime: SourceMime;
  readonly sizeBytes: number;
  readonly modifiedAt: IsoTimestamp;
  readonly pageCount?: number;
}

export interface ManifestCreateProps {
  readonly driveFileId: string;
  readonly filename: string;
  readonly mime: SourceMime;
  readonly sizeBytes: number;
  readonly modifiedAt: IsoTimestamp;
  readonly pageCount?: number;
}

export const Manifest = {
  create(props: ManifestCreateProps): Manifest {
    return Object.freeze({
      driveFileId: props.driveFileId,
      filename: props.filename,
      mime: props.mime,
      sizeBytes: props.sizeBytes,
      modifiedAt: props.modifiedAt,
      pageCount: props.pageCount,
    });
  },
};
