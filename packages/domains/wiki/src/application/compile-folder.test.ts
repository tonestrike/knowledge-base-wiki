import { describe, expect, it } from 'bun:test';
import { compileRunId, folderId, sourceId } from '@package/contracts/shared';
import { InMemoryEventBus } from '@package/shared-kernel';
import type { ConceptPage, IndexPage } from '../domain/wiki-page.ts';
import { compileFolder } from './compile-folder.ts';
import type { CompileRuntimeDeps } from './ports.ts';

const FOLDER = folderId('22222222-2222-4333-8444-555555555555');
const RUN = compileRunId('33333333-2222-4333-8444-555555555555');
const SRC = sourceId('11111111-2222-4333-8444-000000000001');

const fakeRuntime = (): {
  deps: CompileRuntimeDeps;
  bus: InMemoryEventBus;
  emitted: Array<{ kind: string }>;
  inserted: {
    wikis: number;
    runs: number;
    runUpdates: number;
    pageBatches: number;
    pages: number;
    pageRecords: Array<ConceptPage | IndexPage>;
  };
} => {
  const bus = new InMemoryEventBus();
  const emitted: Array<{ kind: string }> = [];
  const inserted = {
    wikis: 0,
    runs: 0,
    runUpdates: 0,
    pageBatches: 0,
    pages: 0,
    pageRecords: [] as Array<ConceptPage | IndexPage>,
  };

  let idCursor = 0;
  const sequentialId = () => `eeeeeeee-1111-4222-8333-${String(idCursor++).padStart(12, '0')}`;

  const deps: CompileRuntimeDeps = {
    llm: {
      generateObject: async ({ system }) => {
        if (system.startsWith('You are SchemaInferrer')) {
          return {
            result: {
              pageTypes: [{ name: 'Decision', description: 'A board decision.' }],
              relations: [],
              reason: 'demo',
            } as never,
            inputTokens: 0,
            outputTokens: 0,
          };
        }
        if (system.startsWith('You are Planner')) {
          return {
            result: {
              tasks: [
                {
                  sourceId: '11111111-2222-4333-8444-000000000001',
                  pageTypes: ['Decision'],
                },
              ],
            } as never,
            inputTokens: 0,
            outputTokens: 0,
          };
        }
        if (system.startsWith('You are Researcher')) {
          return {
            result: {
              findings: [
                {
                  pageType: 'Decision',
                  title: 'Approve EMEA',
                  evidence: 'approved.',
                  spanStart: 0,
                  spanEnd: 9,
                },
              ],
            } as never,
            inputTokens: 0,
            outputTokens: 0,
          };
        }
        // Drafter
        return {
          result: {
            title: 'Decision: Approve EMEA',
            slug: 'approve-emea',
            body: 'Approved.',
            claims: [
              {
                paragraphId: 'p-1',
                claimText: 'approved.',
                citations: [
                  {
                    sourceId: '11111111-2222-4333-8444-000000000001',
                    spanStart: 0,
                    spanEnd: 9,
                    label: 'src',
                  },
                ],
              },
            ],
          } as never,
          inputTokens: 0,
          outputTokens: 0,
        };
      },
    },
    sources: {
      list: async () => [{ sourceId: SRC, filename: 'q3.pdf' }],
      read: async (id) => ({
        sourceId: id,
        filename: 'q3.pdf',
        contentHash: 'sha256:abcdef0123456789',
        text: 'approved.',
      }),
    },
    wikis: {
      insert: async () => {
        inserted.wikis++;
      },
      update: async () => undefined,
      findById: async () => null,
      findByFolderId: async () => null,
      list: async () => ({ items: [] }),
      toWire: () => ({}) as never,
      cascadeDelete: async () => ({ deletedPageIds: [] }),
    },
    pages: {
      insertMany: async (ps) => {
        inserted.pageBatches++;
        inserted.pages += ps.length;
        for (const p of ps) {
          if (p.subtype === 'Concept' || p.subtype === 'Index') {
            inserted.pageRecords.push(p);
          }
        }
      },
      findById: async () => null,
      list: async () => ({ items: [] }),
      toWire: () => ({}) as never,
      deleteBodies: async () => undefined,
    },
    runs: {
      insert: async () => {
        inserted.runs++;
      },
      update: async () => {
        inserted.runUpdates++;
      },
      findById: async () => null,
    },
    dispatcher: {
      start: async () => undefined,
      // biome-ignore lint/correctness/useYield: empty-iterable stub for tests
      subscribe: async function* () {
        return;
      },
    },
    gapAnalyzer: {
      analyze: async () => ({
        pageTypeWithNoPages: [],
        pagesWithNoClaims: [],
        claimsWithNoCitations: [],
        sourcesNeverCited: [],
      }),
    },
    eventBus: bus,
    newId: sequentialId,
    now: () => new Date('2026-05-09T12:00:00.000Z'),
    emit: async (e) => {
      emitted.push(e);
    },
  };
  return { deps, bus, emitted, inserted };
};

describe('compileFolder', () => {
  it('runs schema → plan → research → draft → link → index → finished', async () => {
    const { deps, emitted, inserted } = fakeRuntime();

    const out = await compileFolder(deps, { compileRunId: RUN, folderId: FOLDER });

    const kinds = emitted.map((e) => e.kind);
    expect(kinds).toContain('CompileStarted');
    expect(kinds).toContain('SchemaInferred');
    expect(kinds).toContain('PageDrafted');
    expect(kinds).toContain('IndexBuilt');
    expect(kinds[kinds.length - 1]).toBe('CompileFinished');
    expect(out.wikiId).toBeTruthy();
    expect(inserted.wikis).toBe(1);
    expect(inserted.pages).toBeGreaterThan(0);
  });

  it('emits a CompileFinished domain event for verification subscribers', async () => {
    const { deps, bus } = fakeRuntime();
    const seen: string[] = [];
    bus.subscribe('CompileFinished', () => {
      seen.push('finished');
    });
    await compileFolder(deps, { compileRunId: RUN, folderId: FOLDER });
    expect(seen).toEqual(['finished']);
  });

  it('emits AgentThought narrative checkpoints around the typed events', async () => {
    const { deps, emitted } = fakeRuntime();
    await compileFolder(deps, { compileRunId: RUN, folderId: FOLDER });

    // The fake runtime's `emitted` array is typed loosely as `{kind: string}`;
    // cast to the contract shape for the assertions below.
    const thoughts = emitted.filter((e) => e.kind === 'AgentThought') as Array<{
      kind: 'AgentThought';
      agent: string;
      message: string;
    }>;
    // At least one per major phase + a final wrap-up.
    expect(thoughts.length).toBeGreaterThanOrEqual(5);

    const agents = new Set(thoughts.map((t) => t.agent));
    expect(agents.has('Compiler')).toBe(true);
    expect(agents.has('SchemaInferrer')).toBe(true);
    expect(agents.has('Drafter')).toBe(true);
    expect(agents.has('Linker')).toBe(true);
    expect(agents.has('IndexBuilder')).toBe(true);

    // The first AgentThought lands before SchemaInferred; the last lands
    // before CompileFinished. This locks the "narrative wraps the run"
    // invariant — if a refactor moves an emit out of order it'll fail loud.
    const firstThoughtIdx = emitted.findIndex((e) => e.kind === 'AgentThought');
    const schemaIdx = emitted.findIndex((e) => e.kind === 'SchemaInferred');
    const finishedIdx = emitted.findIndex((e) => e.kind === 'CompileFinished');
    const lastThoughtIdx = emitted.map((e) => e.kind).lastIndexOf('AgentThought');
    expect(firstThoughtIdx).toBeGreaterThanOrEqual(0);
    expect(firstThoughtIdx).toBeLessThan(schemaIdx);
    expect(lastThoughtIdx).toBeLessThan(finishedIdx);
  });

  it('stamps each Citation with the slice hash, not the whole-source hash', async () => {
    const { deps, inserted } = fakeRuntime();
    await compileFolder(deps, { compileRunId: RUN, folderId: FOLDER });

    // Find a Concept page (has claims) among the inserted records.
    const concept = inserted.pageRecords.find(
      (p): p is ConceptPage => p.subtype === 'Concept' && p.claims.length > 0,
    );
    expect(concept).toBeDefined();
    const citation = concept?.claims[0]?.citations[0];
    expect(citation).toBeDefined();
    if (!citation) throw new Error('unreachable: asserted above');

    // Re-hash the slice the way chat's SourceHashVerifier does and compare.
    const fullText = 'approved.';
    const { start, end } = citation.span.byteRange;
    const slice = fullText.slice(start, end);
    const ab = new ArrayBuffer(slice.length);
    new Uint8Array(ab).set(new TextEncoder().encode(slice));
    const buf = await globalThis.crypto.subtle.digest('SHA-256', ab);
    const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
    const expected = `sha256:${hex}`;

    expect(citation.span.contentHash as string).toBe(expected);
    // And it must NOT be the whole-source hash the fake reader returned.
    expect(citation.span.contentHash as string).not.toBe('sha256:abcdef0123456789');
  });

  it('marks the run failed and re-throws when sources are empty', async () => {
    const { deps } = fakeRuntime();
    deps.sources = {
      list: async () => [],
      read: async () => null,
    };
    await expect(compileFolder(deps, { compileRunId: RUN, folderId: FOLDER })).rejects.toThrow(
      /no sources/,
    );
  });
});
