import type { FolderId, IsoTimestamp, SourceId } from '@package/contracts/shared';
import {
  isoTimestamp,
  contentHash as parseContentHash,
  sourceId as parseSourceId,
} from '@package/contracts/shared';
import { Source } from '../domain/source.ts';
import type { ExtractorRegistry } from './extract-source.ts';
import { extractSource } from './extract-source.ts';
import type { IngestionDeps, SourceStorage } from './ports.ts';

export interface IngestFolderDeps extends IngestionDeps {
  readonly extractors: ExtractorRegistry;
}

export interface IngestFolderInput {
  readonly folderId: FolderId;
  readonly driveFileIds: ReadonlyArray<string>;
}

// SF3: the orchestrator now classifies each per-file failure so callers (and
// downstream observers) know whether to retry, ask the user to re-auth, or
// drop the file. Idempotent re-ingest (identical bytes) is its own outcome.
export type IngestFileOutcome =
  | { kind: 'ingested'; driveFileId: string; sourceId: SourceId }
  | { kind: 'unchanged'; driveFileId: string; sourceId: SourceId }
  | {
      kind: 'failed';
      driveFileId: string;
      // 'fetch' (Drive 401/404/429), 'extract' (parser threw), 'storage' (R2),
      // 'persist' (D1), 'unknown' (catch-all). Maps to the typed
      // SourceIngestionFailed event payload.
      reason: IngestFailureReason;
      message: string;
    };

export type IngestFailureReason = 'fetch' | 'extract' | 'storage' | 'persist' | 'unknown';

export interface IngestFolderOutput {
  readonly successful: number;
  readonly failed: number;
  readonly outcomes: ReadonlyArray<IngestFileOutcome>;
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

// SF4 helper: track every R2 key we've successfully written for a given
// in-flight Source so that if a later step throws we can attempt cleanup.
// This is best-effort — R2 may also fail on delete — but the cleanup attempt
// is logged with the source id so an operator can sweep leaked keys.
interface PendingWrites {
  readonly sourceId: SourceId;
  readonly putRaw: boolean;
  readonly putText: boolean;
  readonly putOutline: boolean;
  readonly pageNumbers: number[];
}

const tryCleanupR2 = async (storage: SourceStorage, pending: PendingWrites): Promise<void> => {
  // Best-effort cleanup. The SourceStorage port doesn't expose a delete today
  // (R2 rollback is not transactional anyway), so we log the leaked keys with
  // the sourceId; a sweeper job (Phase 3.x) reconciles against D1 and removes
  // orphans. The error id surfaces in the log so support can correlate.
  const keys: string[] = [];
  if (pending.putRaw) keys.push(`sources/${pending.sourceId}/raw`);
  if (pending.putText) keys.push(`sources/${pending.sourceId}/text`);
  if (pending.putOutline) keys.push(`sources/${pending.sourceId}/outline.json`);
  for (const n of pending.pageNumbers) keys.push(`sources/${pending.sourceId}/pages/${n}.png`);
  if (keys.length > 0) {
    console.error(
      `[ingestion] orphaned R2 objects after partial write for source ${pending.sourceId}:`,
      keys.join(', '),
    );
  }
  void storage;
};

// SF3 / SF5: thin error type used internally to carry classification across
// the try/catch boundary. Not exported — public surface is the discriminated
// `IngestFileOutcome` and the `SourceIngestionFailed` event.
class IngestStepError extends Error {
  constructor(
    readonly reason: IngestFailureReason,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.cause = cause;
  }
}

export async function ingestFolder(
  deps: IngestFolderDeps,
  input: IngestFolderInput,
): Promise<IngestFolderOutput> {
  const outcomes: IngestFileOutcome[] = [];
  let successful = 0;
  let failed = 0;
  for (const driveFileId of input.driveFileIds) {
    try {
      const outcome = await ingestOne(deps, input.folderId, driveFileId);
      outcomes.push(outcome);
      successful++;
    } catch (err) {
      failed++;
      const reason: IngestFailureReason = err instanceof IngestStepError ? err.reason : 'unknown';
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ kind: 'failed', driveFileId, reason, message });
      // Per-file isolation: a Drive blip on file N must not abort siblings.
      // SF5: a real outbox would also write a SourceIngestionFailed row in
      // the same D1 transaction as the source insert; in this slice we emit
      // the event in-memory and rely on logs so an operator can replay them.
      console.error(`[ingestion] failed (${reason})`, driveFileId, err);
      try {
        await deps.eventBus.publish({
          name: 'SourceIngestionFailed',
          occurredAt: deps.now().toISOString(),
          payload: {
            folderId: input.folderId,
            driveFileId,
            reason,
            message,
          },
        });
      } catch (busErr) {
        // The bus itself failing must not change the outcome we report to the
        // caller (the file's failure is what matters).
        console.error('[ingestion] eventBus.publish(SourceIngestionFailed) threw', busErr);
      }
    }
  }
  return { successful, failed, outcomes };
}

async function ingestOne(
  deps: IngestFolderDeps,
  folderId: FolderId,
  driveFileId: string,
): Promise<IngestFileOutcome> {
  const fetched = await runStep('fetch', () => deps.drive.fetch({ driveFileId }));
  const hash = parseContentHash(`sha256:${await sha256Hex(fetched.bytes)}`);

  const existing = await runStep('persist', () =>
    deps.sources.findByDriveFileId({ folderId, driveFileId }),
  );
  if (existing && existing.contentHash === hash) {
    // SF3: idempotent re-ingest is classified as success, not failure. The
    // unique-constraint case (race between two ingests of identical bytes)
    // is handled below via the same equality check.
    return { kind: 'unchanged', driveFileId, sourceId: existing.id };
  }

  const id = parseSourceId(deps.newId());
  const pending: PendingWrites = {
    sourceId: id,
    putRaw: false,
    putText: false,
    putOutline: false,
    pageNumbers: [],
  };
  try {
    await runStep('storage', () =>
      deps.storage.putRaw({ sourceId: id, bytes: fetched.bytes, contentHash: hash }),
    );
    (pending as { putRaw: boolean }).putRaw = true;

    const extracted = await runStep('extract', () =>
      extractSource(deps.extractors, {
        mime: fetched.manifest.mime,
        bytes: fetched.bytes,
      }),
    );
    await runStep('storage', () => deps.storage.putText({ sourceId: id, text: extracted.text }));
    (pending as { putText: boolean }).putText = true;
    await runStep('storage', () =>
      deps.storage.putOutline({ sourceId: id, outline: extracted.outline }),
    );
    (pending as { putOutline: boolean }).putOutline = true;
    for (const img of extracted.pageImages) {
      await runStep('storage', () =>
        deps.storage.putPageImage({
          sourceId: id,
          pageNumber: img.pageNumber,
          png: img.png,
        }),
      );
      pending.pageNumbers.push(img.pageNumber);
    }

    const fetchedAt: IsoTimestamp = isoTimestamp(deps.now().toISOString());
    const source = Source.create({
      id,
      folderId,
      manifest: { ...fetched.manifest, pageCount: extracted.pageCount },
      contentHash: hash,
      fetchedAt,
    });
    try {
      await deps.sources.insert(source);
    } catch (err) {
      // SF3: D1 unique-constraint == idempotent success. A concurrent ingest
      // wrote the same (folder_id, drive_file_id, content_hash) row; we
      // discover this by re-reading and comparing the hash. If the existing
      // row has our hash, the work the other writer did is what we'd have
      // produced — fine.
      const conflict = await deps.sources.findByDriveFileId({ folderId, driveFileId });
      if (conflict && conflict.contentHash === hash) {
        await tryCleanupR2(deps.storage, pending);
        return { kind: 'unchanged', driveFileId, sourceId: conflict.id };
      }
      throw new IngestStepError('persist', 'sources.insert failed', err);
    }

    // SF5: the publish step happens AFTER the D1 insert, so a publish failure
    // can't roll back the source row. A production outbox writes the event to
    // a `domain_events` table inside the same D1 transaction as the insert;
    // this slice keeps the in-memory bus and logs publish failures so the
    // operator can replay them. (See 2.D apply-correction for the same
    // pattern recommendation.)
    try {
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
    } catch (busErr) {
      // D1 + R2 are committed; downstream subscribers missed the notification.
      // Log loudly so an operator can replay; do not fail the per-file outcome.
      console.error(
        `[ingestion] SourceIngested publish failed for source ${source.id} — D1+R2 written without downstream notification`,
        busErr,
      );
    }
    return { kind: 'ingested', driveFileId, sourceId: source.id };
  } catch (err) {
    // SF4: best-effort cleanup. The R2 client doesn't expose delete via the
    // SourceStorage port today, so we log the leaked key set; a Phase 3.x
    // sweeper reconciles against D1.
    await tryCleanupR2(deps.storage, pending);
    throw err;
  }
}

const runStep = async <T>(reason: IngestFailureReason, step: () => Promise<T>): Promise<T> => {
  try {
    return await step();
  } catch (err) {
    if (err instanceof IngestStepError) throw err;
    throw new IngestStepError(reason, err instanceof Error ? err.message : String(err), err);
  }
};
