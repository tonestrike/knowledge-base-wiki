import { describe, expect, it } from 'bun:test';
import { folderId, contentHash as parseContentHash, sourceId } from '@package/contracts/shared';
import type { Manifest } from './source.ts';
import { Source, sourceFingerprint } from './source.ts';

describe('Source aggregate', () => {
  const fid = folderId('22222222-2222-4333-8444-555555555555');
  const sid = sourceId('11111111-2222-4333-8444-000000000001');
  const baseManifest: Manifest = {
    driveFileId: 'drive:abc',
    filename: 'q3.pdf',
    mime: 'application/pdf',
    sizeBytes: 145_000,
    modifiedAt: '2026-05-09T11:00:00.000Z',
    pageCount: 12,
  };

  it('is created from id + folder + manifest + content hash + fetchedAt', () => {
    const s = Source.create({
      id: sid,
      folderId: fid,
      manifest: baseManifest,
      contentHash: parseContentHash('sha256:abc'),
      fetchedAt: '2026-05-09T12:00:00.000Z',
    });
    expect(s.id).toBe(sid);
    expect(s.contentHash).toBe(parseContentHash('sha256:abc'));
    expect(s.manifest.filename).toBe('q3.pdf');
    expect(s.manifest.pageCount).toBe(12);
  });

  it('treats two Sources with the same drive id but different content hash as different', () => {
    const a = Source.create({
      id: sid,
      folderId: fid,
      manifest: baseManifest,
      contentHash: parseContentHash('sha256:aaaa'),
      fetchedAt: '2026-05-09T12:00:00.000Z',
    });
    const b = Source.create({
      id: sourceId('11111111-2222-4333-8444-000000000002'),
      folderId: fid,
      manifest: baseManifest,
      contentHash: parseContentHash('sha256:bbbb'),
      fetchedAt: '2026-05-09T12:01:00.000Z',
    });
    expect(sourceFingerprint(a)).not.toBe(sourceFingerprint(b));
  });

  it('fingerprints identically when re-fetched with the same bytes', () => {
    const a = Source.create({
      id: sid,
      folderId: fid,
      manifest: baseManifest,
      contentHash: parseContentHash('sha256:aaaa'),
      fetchedAt: '2026-05-09T12:00:00.000Z',
    });
    const b = Source.create({
      id: sourceId('11111111-2222-4333-8444-000000000003'),
      folderId: fid,
      manifest: baseManifest,
      contentHash: parseContentHash('sha256:aaaa'),
      fetchedAt: '2026-05-09T13:00:00.000Z',
    });
    expect(sourceFingerprint(a)).toBe(sourceFingerprint(b));
  });

  it('rejects mutation attempts at runtime (frozen)', () => {
    const s = Source.create({
      id: sid,
      folderId: fid,
      manifest: baseManifest,
      contentHash: parseContentHash('sha256:aaaa'),
      fetchedAt: '2026-05-09T12:00:00.000Z',
    });
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: deliberate runtime-frozen check
      (s as any).contentHash = 'sha256:other';
    }).toThrow();
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: deliberate runtime-frozen check
      (s.manifest as any).filename = 'evil.pdf';
    }).toThrow();
  });
});
