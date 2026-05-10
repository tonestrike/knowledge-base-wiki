import { describe, expect, it } from 'bun:test';
import {
  folderId,
  isoTimestamp,
  contentHash as parseContentHash,
  sourceId,
} from '@package/contracts/shared';
import { Manifest } from '../domain/manifest.ts';
import { Source } from '../domain/source.ts';
import { SourceNotFoundError, getSource } from './get-source.ts';
import { listSources } from './list-sources.ts';
import type { IngestionDeps } from './ports.ts';

const fid = folderId('22222222-2222-4333-8444-555555555555');
const sid = sourceId('11111111-2222-4333-8444-000000000001');

const sample = Source.create({
  id: sid,
  folderId: fid,
  manifest: Manifest.create({
    driveFileId: 'drive:abc',
    filename: 'q3.pdf',
    mime: 'application/pdf',
    sizeBytes: 1,
    modifiedAt: isoTimestamp('2026-05-09T11:00:00.000Z'),
    pageCount: 1,
  }),
  contentHash: parseContentHash('sha256:abc'),
  fetchedAt: isoTimestamp('2026-05-09T12:00:00.000Z'),
});

const makeDeps = (): IngestionDeps => ({
  drive: {} as never,
  storage: {} as never,
  sources: {
    insert: async () => undefined,
    findById: async (id) => (id === sid ? sample : null),
    findByDriveFileId: async () => null,
    list: async ({ folderId: f, limit }) => ({
      items: f === fid ? [sample].slice(0, limit) : [],
    }),
    toWire: (s) => ({
      id: s.id,
      folderId: s.folderId,
      driveFileId: s.manifest.driveFileId,
      filename: s.manifest.filename,
      mime: s.manifest.mime,
      contentHash: s.contentHash,
      pageCount: s.manifest.pageCount,
      fetchedAt: s.fetchedAt,
    }),
  },
  folders: {} as never,
  oauth: {} as never,
  oauthState: {} as never,
  eventBus: { publish: async () => undefined, subscribe: () => () => undefined },
  newId: () => '',
  now: () => new Date(),
});

describe('getSource', () => {
  it('returns the wire shape for an existing source', async () => {
    const out = await getSource(makeDeps(), { id: sid });
    expect(out.id).toBe(sid);
    expect(out.filename).toBe('q3.pdf');
  });

  it('throws SourceNotFoundError when missing', async () => {
    const deps = makeDeps();
    deps.sources.findById = async () => null;
    await expect(getSource(deps, { id: sid })).rejects.toBeInstanceOf(SourceNotFoundError);
  });
});

describe('listSources', () => {
  it('returns wire-shape items for the folder', async () => {
    const out = await listSources(makeDeps(), { folderId: fid, limit: 10 });
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.filename).toBe('q3.pdf');
  });

  it('returns empty when the folder has no sources', async () => {
    const deps = makeDeps();
    deps.sources.list = async () => ({ items: [] });
    const out = await listSources(deps, { folderId: fid, limit: 10 });
    expect(out.items).toHaveLength(0);
  });
});
