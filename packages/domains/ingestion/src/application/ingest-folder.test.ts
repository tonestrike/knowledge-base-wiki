import { describe, expect, it } from 'bun:test';
import { folderId, userId } from '@package/contracts/shared';
import type { ContentHash } from '@package/contracts/shared';
import { InMemoryEventBus } from '@package/shared-kernel';
import { Outline } from '../domain/outline.ts';
import { Source } from '../domain/source.ts';
import type { ExtractorRegistry } from './extract-source.ts';
import { ingestFolder } from './ingest-folder.ts';
import type { IngestionDeps } from './ports.ts';

const fid = folderId('22222222-2222-4333-8444-555555555555');
const uid = userId('99999999-2222-4333-8444-555555555555');

interface Fakes {
  deps: IngestionDeps;
  extractors: ExtractorRegistry;
  bus: InMemoryEventBus;
  inserted: Source[];
}

const baseExtractors = (): ExtractorRegistry => ({
  pdf: {
    extract: async () => ({
      text: 'hello',
      outline: Outline.empty(),
      pageCount: 1,
      pageImages: [{ pageNumber: 1, png: new Uint8Array([0]) }],
    }),
  },
  doc: {
    extract: async () => ({
      text: 'd',
      outline: Outline.empty(),
      pageCount: 1,
      pageImages: [],
    }),
  },
  sheet: {
    extract: async () => ({
      text: 's',
      outline: Outline.empty(),
      pageCount: 1,
      pageImages: [],
    }),
  },
  slide: {
    extract: async () => ({
      text: 'p',
      outline: Outline.empty(),
      pageCount: 1,
      pageImages: [],
    }),
  },
});

const makeFakes = (overrides: Partial<IngestionDeps> = {}): Fakes => {
  const bus = new InMemoryEventBus();
  const inserted: Source[] = [];
  let counter = 0;
  const nextId = (): string => {
    counter++;
    const tail = String(counter).padStart(12, '0');
    return `11111111-2222-4333-8444-${tail}`;
  };

  const deps: IngestionDeps = {
    drive: {
      startAuth: async () => ({ state: '', authorizationUrl: '' }),
      completeAuth: async () => {
        throw new Error('n/a');
      },
      listFolders: async () => ({ folders: [] }),
      fetch: async ({ driveFileId }) => ({
        manifest: {
          driveFileId,
          filename: `${driveFileId}.pdf`,
          mime: 'application/pdf',
          sizeBytes: 1,
          modifiedAt: '2026-05-09T11:00:00.000Z',
          pageCount: 1,
        },
        bytes: new TextEncoder().encode(`bytes-${driveFileId}`),
      }),
    },
    storage: {
      putRaw: async () => undefined,
      putText: async () => undefined,
      putOutline: async () => undefined,
      putPageImage: async () => undefined,
      getText: async () => null,
      getOutline: async () => null,
    },
    sources: {
      insert: async (s) => {
        inserted.push(s);
      },
      findById: async () => null,
      findByDriveFileId: async () => null,
      list: async () => ({ items: [] }),
      toWire: () => ({}) as never,
    },
    folders: {
      upsert: async () => undefined,
      findById: async () => ({
        id: fid,
        userId: uid,
        driveFolderId: 'd-folder',
        name: 'demo',
      }),
    },
    oauth: { saveTokens: async () => undefined, loadTokens: async () => null },
    oauthState: { set: async () => undefined, consume: async () => null },
    eventBus: bus,
    newId: nextId,
    now: () => new Date('2026-05-09T12:00:00.000Z'),
    ...overrides,
  };
  return { deps, extractors: baseExtractors(), bus, inserted };
};

describe('ingestFolder', () => {
  it('fetches → extracts → stores → publishes SourceIngested per file', async () => {
    const fakes = makeFakes();
    const filenames: string[] = [];
    fakes.bus.subscribe('SourceIngested', (e) => {
      filenames.push((e.payload as { filename: string }).filename);
    });

    const out = await ingestFolder(
      { ...fakes.deps, extractors: fakes.extractors },
      { folderId: fid, driveFileIds: ['drive:a', 'drive:b'] },
    );
    expect(out.successful).toBe(2);
    expect(out.failed).toBe(0);
    expect(filenames).toEqual(['drive:a.pdf', 'drive:b.pdf']);
    expect(fakes.inserted).toHaveLength(2);
  });

  it('counts failures and continues across siblings', async () => {
    const fakes = makeFakes({
      drive: {
        startAuth: async () => ({ state: '', authorizationUrl: '' }),
        completeAuth: async () => {
          throw new Error('n/a');
        },
        listFolders: async () => ({ folders: [] }),
        fetch: async ({ driveFileId }) => {
          if (driveFileId === 'bad') throw new Error('drive blip');
          return {
            manifest: {
              driveFileId,
              filename: `${driveFileId}.pdf`,
              mime: 'application/pdf',
              sizeBytes: 1,
              modifiedAt: '2026-05-09T11:00:00.000Z',
              pageCount: 1,
            },
            bytes: new Uint8Array([1]),
          };
        },
      },
    });
    const events: unknown[] = [];
    fakes.bus.subscribe('SourceIngested', (e) => {
      events.push(e);
    });
    const out = await ingestFolder(
      { ...fakes.deps, extractors: fakes.extractors },
      { folderId: fid, driveFileIds: ['ok', 'bad', 'ok2'] },
    );
    expect(out.successful).toBe(2);
    expect(out.failed).toBe(1);
    expect(events).toHaveLength(2);
  });

  it('is idempotent — identical bytes produce no new Source and no event', async () => {
    let storedHash: ContentHash | null = null;
    const fakes = makeFakes();
    // Override findByDriveFileId to "find" the previous source after the first ingest
    fakes.deps.sources.findByDriveFileId = async ({ driveFileId }) => {
      if (storedHash === null) return null;
      return Source.create({
        id: '11111111-2222-4333-8444-000000000999' as never,
        folderId: fid,
        manifest: {
          driveFileId,
          filename: `${driveFileId}.pdf`,
          mime: 'application/pdf',
          sizeBytes: 1,
          modifiedAt: '2026-05-09T11:00:00.000Z',
          pageCount: 1,
        },
        contentHash: storedHash,
        fetchedAt: '2026-05-09T11:00:00.000Z',
      });
    };
    fakes.deps.sources.insert = async (s) => {
      storedHash = s.contentHash;
      fakes.inserted.push(s);
    };
    const events: unknown[] = [];
    fakes.bus.subscribe('SourceIngested', (e) => {
      events.push(e);
    });

    await ingestFolder(
      { ...fakes.deps, extractors: fakes.extractors },
      { folderId: fid, driveFileIds: ['drive:a'] },
    );
    expect(fakes.inserted).toHaveLength(1);
    expect(events).toHaveLength(1);

    // Re-ingest identical bytes → no-op.
    const out = await ingestFolder(
      { ...fakes.deps, extractors: fakes.extractors },
      { folderId: fid, driveFileIds: ['drive:a'] },
    );
    expect(out.successful).toBe(1); // no error → counted as success
    expect(fakes.inserted).toHaveLength(1); // but not re-inserted
    expect(events).toHaveLength(1); // and no new event
  });
});
