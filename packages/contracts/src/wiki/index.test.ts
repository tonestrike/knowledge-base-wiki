import { describe, expect, it } from 'bun:test';
import { wikiContract } from './index.ts';
import { demoSchema, mockCompileEventStream, mockWiki, mockWikiPage } from './mocks.ts';

describe('wiki contract', () => {
  it('exposes the union of wiki+page+compile procedures', () => {
    expect(Object.keys(wikiContract).sort()).toEqual([
      'getCompileRun',
      'getPage',
      'getSchema',
      'getWiki',
      'listPages',
      'listWikis',
      'startCompile',
      'streamCompileEvents',
    ]);
  });
});

describe('wiki mocks', () => {
  it('mockWiki returns a parseable Wiki with a 4-PageType schema', () => {
    const w = mockWiki();
    expect(w.schema.pageTypes.map((p) => p.name)).toEqual(['Decision', 'Metric', 'Person', 'Risk']);
  });

  it('mockWikiPage returns a Concept page by default', () => {
    const p = mockWikiPage();
    expect(p.subtype).toBe('Concept');
    expect(p.claims.length).toBeGreaterThan(0);
  });

  it('mockCompileEventStream emits Started → SchemaInferred → ... → CompileFinished', async () => {
    const kinds: string[] = [];
    for await (const e of mockCompileEventStream()) kinds.push(e.kind);
    expect(kinds[0]).toBe('CompileStarted');
    expect(kinds[1]).toBe('SchemaInferred');
    expect(kinds[kinds.length - 1]).toBe('CompileFinished');
  });

  it('demoSchema is the locked Decision/Metric/Person/Risk schema', () => {
    expect(demoSchema.pageTypes).toHaveLength(4);
    expect(demoSchema.relations.length).toBeGreaterThan(0);
  });
});
