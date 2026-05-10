import { contentHash, folderId, sourceId } from '../shared/ids.ts';
import type { IngestEvent } from './events.ts';
import type { ListSourcesOutput, Source } from './sources.ts';

const FOLDER = folderId('22222222-2222-4333-8444-555555555555');
const SRC1 = sourceId('11111111-2222-4333-8444-000000000001');
const SRC2 = sourceId('11111111-2222-4333-8444-000000000002');

export const mockSource = (overrides: Partial<Source> = {}): Source => ({
  id: SRC1,
  folderId: FOLDER,
  driveFileId: 'drive:abc',
  filename: 'q3-board-minutes.pdf',
  mime: 'application/pdf',
  contentHash: contentHash('sha256:fb1c4e3a7b0a4dabcdef'),
  pageCount: 12,
  fetchedAt: '2026-05-09T12:00:00.000Z',
  ...overrides,
});

export const mockListSources = (): ListSourcesOutput => ({
  items: [
    mockSource(),
    mockSource({
      id: SRC2,
      filename: 'q3-investor-update.pdf',
      contentHash: contentHash('sha256:fa1cab1edabcdef00012'),
      pageCount: 8,
    }),
  ],
});

export async function* mockIngestEventStream(): AsyncIterable<IngestEvent> {
  yield { kind: 'IngestStarted', folderId: FOLDER, totalSources: 2 };
  yield { kind: 'SourceFetched', sourceId: SRC1, filename: 'q3-board-minutes.pdf' };
  yield { kind: 'SourceExtracted', sourceId: SRC1, bytes: 145_000, pageCount: 12 };
  yield { kind: 'IngestFinished', folderId: FOLDER, successful: 2, failed: 0 };
}
