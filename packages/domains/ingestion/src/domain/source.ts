import type { ContentHash, FolderId, IsoTimestamp, SourceId } from '@package/contracts/shared';
import { Manifest } from './manifest.ts';

export type { SourceMime } from './manifest.ts';
export { Manifest } from './manifest.ts';

// `Source` is the aggregate root. Identity is rooted in (id, contentHash). If
// the underlying Drive file's bytes change, callers MUST mint a new Source —
// never mutate. Constructed only via `Source.create`; the `Source` symbol
// below is the namespace + a brand-tagged type, NOT a bare interface, so plain
// object literals don't satisfy `Source` (TD1). Runtime invariant: frozen.
export interface Source {
  readonly _tag: 'Source';
  readonly id: SourceId;
  readonly folderId: FolderId;
  readonly manifest: Manifest;
  readonly contentHash: ContentHash;
  readonly fetchedAt: IsoTimestamp;
}

export interface SourceCreateProps {
  readonly id: SourceId;
  readonly folderId: FolderId;
  readonly manifest: Manifest;
  readonly contentHash: ContentHash;
  readonly fetchedAt: IsoTimestamp;
}

export const Source = {
  create(props: SourceCreateProps): Source {
    // Defensive: re-freeze the manifest in case a caller forgot to use
    // `Manifest.create`. Cheap and keeps the aggregate invariant local.
    const manifest = Object.isFrozen(props.manifest)
      ? props.manifest
      : Manifest.create(props.manifest);
    return Object.freeze({
      _tag: 'Source' as const,
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
