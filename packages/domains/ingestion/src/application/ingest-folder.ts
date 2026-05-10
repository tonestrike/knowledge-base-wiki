import type { FolderId } from '@package/contracts/shared';
import {
  contentHash as parseContentHash,
  sourceId as parseSourceId,
} from '@package/contracts/shared';
import { Source } from '../domain/source.ts';
import type { ExtractorRegistry } from './extract-source.ts';
import { extractSource } from './extract-source.ts';
import type { IngestionDeps } from './ports.ts';

export interface IngestFolderDeps extends IngestionDeps {
  readonly extractors: ExtractorRegistry;
}

export interface IngestFolderInput {
  readonly folderId: FolderId;
  readonly driveFileIds: ReadonlyArray<string>;
}

export interface IngestFolderOutput {
  readonly successful: number;
  readonly failed: number;
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  // Web Crypto requires a BufferSource backed by ArrayBuffer (not SharedArrayBuffer).
  // Bun's strict types reject a bare Uint8Array<ArrayBufferLike>; copy into a fresh
  // ArrayBuffer to keep the digest call portable across runtimes.
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const buf = await crypto.subtle.digest('SHA-256', ab);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
};

export async function ingestFolder(
  deps: IngestFolderDeps,
  input: IngestFolderInput,
): Promise<IngestFolderOutput> {
  let successful = 0;
  let failed = 0;
  for (const driveFileId of input.driveFileIds) {
    try {
      await ingestOne(deps, input.folderId, driveFileId);
      successful++;
    } catch (err) {
      failed++;
      // Per-file isolation: a Drive blip on file N must not abort siblings.
      // Production wraps this in a retry-with-backoff DLQ; v1 logs and counts.
      console.error('[ingestion] failed', driveFileId, err);
    }
  }
  return { successful, failed };
}

async function ingestOne(
  deps: IngestFolderDeps,
  folderId: FolderId,
  driveFileId: string,
): Promise<void> {
  const fetched = await deps.drive.fetch({ driveFileId });
  const hash = parseContentHash(`sha256:${await sha256Hex(fetched.bytes)}`);

  const existing = await deps.sources.findByDriveFileId({ folderId, driveFileId });
  if (existing && existing.contentHash === hash) {
    // Idempotent: identical bytes → no new Source, no event.
    return;
  }

  const id = parseSourceId(deps.newId());
  await deps.storage.putRaw({ sourceId: id, bytes: fetched.bytes, contentHash: hash });

  const extracted = await extractSource(deps.extractors, {
    mime: fetched.manifest.mime,
    bytes: fetched.bytes,
  });
  await deps.storage.putText({ sourceId: id, text: extracted.text });
  await deps.storage.putOutline({ sourceId: id, outline: extracted.outline });
  for (const img of extracted.pageImages) {
    await deps.storage.putPageImage({
      sourceId: id,
      pageNumber: img.pageNumber,
      png: img.png,
    });
  }

  const source = Source.create({
    id,
    folderId,
    manifest: { ...fetched.manifest, pageCount: extracted.pageCount },
    contentHash: hash,
    fetchedAt: deps.now().toISOString(),
  });
  await deps.sources.insert(source);

  await deps.eventBus.publish({
    name: 'SourceIngested',
    occurredAt: deps.now().toISOString(),
    payload: {
      sourceId: source.id,
      folderId: source.folderId,
      contentHash: source.contentHash,
      filename: source.manifest.filename,
    },
  });
}
