import { describe, expect, it } from 'bun:test';
import { folderId, wikiId } from '@package/contracts/shared';
import { demoSchema } from '@package/contracts/wiki';
import { Wiki } from './wiki.ts';

describe('Wiki aggregate', () => {
  it('cannot be created without at least one PageType in its schema', () => {
    expect(() =>
      Wiki.create({
        id: wikiId('44444444-2222-4333-8444-555555555555'),
        folderId: folderId('22222222-2222-4333-8444-555555555555'),
        schema: { pageTypes: [], relations: [] },
        createdAt: '2026-05-09T12:00:00.000Z',
      }),
    ).toThrow(/at least one PageType/);
  });

  it('records compile by setting updatedAt, lastCompiledAt, and pageCount', () => {
    const w = Wiki.create({
      id: wikiId('44444444-2222-4333-8444-555555555555'),
      folderId: folderId('22222222-2222-4333-8444-555555555555'),
      schema: demoSchema,
      createdAt: '2026-05-09T12:00:00.000Z',
    });
    const w2 = Wiki.recordCompile(w, '2026-05-09T12:05:00.000Z', 18);
    expect(w2.lastCompiledAt).toBe('2026-05-09T12:05:00.000Z');
    expect(w2.updatedAt).toBe('2026-05-09T12:05:00.000Z');
    expect(w2.pageCount).toBe(18);
  });
});
