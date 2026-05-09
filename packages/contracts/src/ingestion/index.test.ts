import { describe, expect, it } from 'bun:test';
import { ingestionContract } from './index.ts';
import { mockIngestEventStream, mockListSources, mockSource } from './mocks.ts';

describe('ingestion contract', () => {
  it('exposes auth, folders, sources, ingest, events', () => {
    expect(Object.keys(ingestionContract).sort()).toEqual([
      'authCallback',
      'authStart',
      'getSource',
      'ingestFolder',
      'listFolders',
      'listSources',
      'registerFolder',
      'streamIngestEvents',
    ]);
  });
});

describe('ingestion mocks', () => {
  it('mockSource returns a parseable Source', () => {
    expect(() => mockSource()).not.toThrow();
  });

  it('mockListSources returns at least one source', () => {
    const out = mockListSources();
    expect(out.items.length).toBeGreaterThan(0);
  });

  it('mockIngestEventStream emits start → fetched → extracted → finished', async () => {
    const events: string[] = [];
    for await (const e of mockIngestEventStream()) events.push(e.kind);
    expect(events).toEqual(['IngestStarted', 'SourceFetched', 'SourceExtracted', 'IngestFinished']);
  });
});
