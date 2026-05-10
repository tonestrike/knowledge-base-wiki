import { describe, expect, it } from 'bun:test';
import { compileRunId, folderId, sourceId } from '@package/contracts/shared';
import { InMemoryEventBus } from '@package/shared-kernel';
import { compileFolder } from './compile-folder.ts';
import type { CompileRuntimeDeps } from './ports.ts';

const FOLDER = folderId('22222222-2222-4333-8444-555555555555');
const RUN = compileRunId('33333333-2222-4333-8444-555555555555');
const SRC = sourceId('11111111-2222-4333-8444-000000000001');

const fakeRuntime = (): {
  deps: CompileRuntimeDeps;
  bus: InMemoryEventBus;
  emitted: Array<{ kind: string }>;
  inserted: { wikis: number; runs: number; runUpdates: number; pageBatches: number; pages: number };
} => {
  const bus = new InMemoryEventBus();
  const emitted: Array<{ kind: string }> = [];
  const inserted = { wikis: 0, runs: 0, runUpdates: 0, pageBatches: 0, pages: 0 };

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
    },
    pages: {
      insertMany: async (ps) => {
        inserted.pageBatches++;
        inserted.pages += ps.length;
      },
      findById: async () => null,
      list: async () => ({ items: [] }),
      toWire: () => ({}) as never,
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
