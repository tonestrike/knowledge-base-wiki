import { describe, expect, it } from 'bun:test';
import { CompileEvent } from './compile.ts';
import { wikiContract } from './index.ts';
import { demoSchema, mockCompileEventStream, mockWiki, mockWikiPage } from './mocks.ts';

describe('wiki contract', () => {
  it('exposes the union of wiki+page+compile procedures', () => {
    expect(Object.keys(wikiContract).sort()).toEqual([
      'gaps',
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

  it('mockCompileEventStream emits Started → SchemaInferred → ... → CompileFinished, interleaved with AgentThought narrative', async () => {
    const kinds: string[] = [];
    for await (const e of mockCompileEventStream()) kinds.push(e.kind);
    expect(kinds[0]).toBe('CompileStarted');
    // SchemaInferred lands after the orchestrator-level "reading sources" /
    // "inferring schema" thought lines but is no longer the second event.
    expect(kinds).toContain('SchemaInferred');
    expect(kinds.indexOf('SchemaInferred')).toBeGreaterThan(kinds.indexOf('CompileStarted'));
    expect(kinds.filter((k) => k === 'AgentThought').length).toBeGreaterThanOrEqual(5);
    expect(kinds[kinds.length - 1]).toBe('CompileFinished');
  });

  it('demoSchema is the locked Decision/Metric/Person/Risk schema', () => {
    expect(demoSchema.pageTypes).toHaveLength(4);
    expect(demoSchema.relations.length).toBeGreaterThan(0);
  });
});

describe('CompileEvent.AgentThought', () => {
  it('round-trips through CompileEvent.parse() and narrows to AgentThought', () => {
    const parsed = CompileEvent.parse({
      kind: 'AgentThought',
      compileRunId: '11111111-1111-4111-8111-111111111111',
      agent: 'Drafter',
      message: 'Drafting the Methods page from the helpful-harmless paper…',
    });
    expect(parsed.kind).toBe('AgentThought');
    if (parsed.kind === 'AgentThought') {
      expect(parsed.agent).toBe('Drafter');
      expect(parsed.message).toContain('helpful-harmless');
    }
  });

  it('rejects unknown agent names', () => {
    expect(() =>
      CompileEvent.parse({
        kind: 'AgentThought',
        compileRunId: '11111111-1111-4111-8111-111111111111',
        agent: 'Imposter',
        message: 'should fail',
      }),
    ).toThrow();
  });
});
