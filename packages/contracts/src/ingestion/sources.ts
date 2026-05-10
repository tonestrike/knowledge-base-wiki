import { oc } from '@orpc/contract';
import { z } from 'zod';
import { FolderId, SourceId } from '../shared/ids.ts';
import { ContentHash } from '../shared/span.ts';

export const SourceMime = z.enum([
  'application/pdf',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'text/plain',
  'text/markdown',
]);

export const Source = z.object({
  id: SourceId,
  folderId: FolderId,
  driveFileId: z.string().min(1),
  filename: z.string().min(1),
  mime: SourceMime,
  contentHash: ContentHash,
  pageCount: z.number().int().nonnegative().optional(),
  fetchedAt: z.string().datetime(),
});
export type Source = z.infer<typeof Source>;

export const GetSourceInput = z.object({ id: SourceId });
export const ListSourcesInput = z.object({
  folderId: FolderId,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export const ListSourcesOutput = z.object({
  items: z.array(Source),
  nextCursor: z.string().optional(),
});
export type ListSourcesOutput = z.infer<typeof ListSourcesOutput>;

export const StartIngestInput = z.object({ folderId: FolderId });
export const StartIngestOutput = z.object({
  folderId: FolderId,
  sourceCount: z.number().int().nonnegative(),
});

export const Folder = z.object({
  id: FolderId,
  name: z.string().min(1),
  driveFolderId: z.string().min(1),
});
export type Folder = z.infer<typeof Folder>;
export const GetFolderInput = z.object({ id: FolderId });

export const sourcesContract = {
  getFolder: oc
    .route({ method: 'GET', path: '/folders/{id}' })
    .input(GetFolderInput)
    .output(Folder),
  getSource: oc
    .route({ method: 'GET', path: '/sources/{id}' })
    .input(GetSourceInput)
    .output(Source),
  listSources: oc
    .route({ method: 'GET', path: '/sources' })
    .input(ListSourcesInput)
    .output(ListSourcesOutput),
  ingestFolder: oc
    .route({ method: 'POST', path: '/folders/{folderId}/ingest' })
    .input(StartIngestInput)
    .output(StartIngestOutput),
};
