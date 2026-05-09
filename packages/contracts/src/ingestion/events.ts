import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { FolderId, SourceId } from '../shared/ids.ts';

export const IngestStarted = z.object({
  kind: z.literal('IngestStarted'),
  folderId: FolderId,
  totalSources: z.number().int().nonnegative(),
});

export const SourceFetched = z.object({
  kind: z.literal('SourceFetched'),
  sourceId: SourceId,
  filename: z.string(),
});

export const SourceExtracted = z.object({
  kind: z.literal('SourceExtracted'),
  sourceId: SourceId,
  bytes: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative().optional(),
});

export const IngestFailed = z.object({
  kind: z.literal('IngestFailed'),
  sourceId: SourceId.optional(),
  filename: z.string().optional(),
  message: z.string(),
});

export const IngestFinished = z.object({
  kind: z.literal('IngestFinished'),
  folderId: FolderId,
  successful: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export const IngestEvent = z.discriminatedUnion('kind', [
  IngestStarted,
  SourceFetched,
  SourceExtracted,
  IngestFailed,
  IngestFinished,
]);
export type IngestEvent = z.infer<typeof IngestEvent>;

export const StreamIngestInput = z.object({ folderId: FolderId });

export const ingestEventsContract = {
  streamIngestEvents: oc
    .route({ method: 'GET', path: '/folders/{folderId}/ingest/events' })
    .input(StreamIngestInput)
    .output(eventIterator(IngestEvent)),
};
