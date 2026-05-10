import { describe, expect, it } from 'bun:test';
import {
  citationId,
  claimId,
  lintRunId,
  sourceId,
  wikiId,
  wikiPageId,
} from '@package/contracts/shared';
import type {
  Citation,
  Claim,
  ClaimId,
  LintFindingId,
  LintRunId,
  WikiId,
} from '@package/contracts/shared';
import type { LintEvent } from '@package/contracts/verification';
import { InMemoryEventBus } from '@package/shared-kernel';
import type { LintFinding } from '../domain/lint-finding.ts';
import type { LintRun } from '../domain/lint-run.ts';
import { lintWiki } from './lint-wiki.ts';
import type {
  AnthropicVerifier,
  LintFindingRepository,
  LintRunRepository,
  LintRuntimeDeps,
} from './ports.ts';

const wid = wikiId('44444444-2222-4333-8444-555555555555');
const lid = lintRunId('77777777-2222-4333-8444-555555555555');
const PAGE = wikiPageId('dddddddd-1111-4222-8333-444444444444');
const SRC = sourceId('11111111-2222-4333-8444-000000000001');

const buildClaims = (n: number): Array<{ wikiPageId: typeof PAGE; claim: Claim }> =>
  Array.from({ length: n }).map((_, i) => {
    const idHex = i.toString(16).padStart(12, '0');
    return {
      wikiPageId: PAGE,
      claim: {
        id: claimId(`cccccccc-1111-4222-8333-${idHex}`),
        wikiPageId: PAGE,
        paragraphId: `p-${i}`,
        claimText: `claim ${i}`,
        citations: [
          {
            id: citationId(`aaaaaaaa-1111-4222-8333-${idHex}`),
            label: 'src',
            span: { sourceId: SRC, byteRange: { start: 0, end: 1 }, contentHash: 'sha256:abc' },
          },
        ] satisfies Citation[],
      } satisfies Claim,
    };
  });

interface FakeRuntime {
  deps: LintRuntimeDeps;
  emitted: LintEvent[];
  inserted: LintFinding[];
  runUpdates: LintRun[];
  peakConcurrency: () => number;
}

const fakeRuntime = (
  claims: ReturnType<typeof buildClaims>,
  verifierImpl?: AnthropicVerifier['audit'],
): FakeRuntime => {
  const emitted: LintEvent[] = [];
  const inserted: LintFinding[] = [];
  const runUpdates: LintRun[] = [];
  let inFlight = 0;
  let peak = 0;
  let counter = 0;
  let lastRun: LintRun | undefined;

  const runs: LintRunRepository = {
    insert: async (r) => {
      lastRun = r;
      runUpdates.push(r);
    },
    update: async (r) => {
      lastRun = r;
      runUpdates.push(r);
    },
    findById: async () => lastRun ?? null,
    list: async () => ({ items: [] }),
    toWire: () => ({}) as never,
  };
  const findings: LintFindingRepository = {
    insertMany: async (fs) => {
      inserted.push(...fs);
    },
    update: async () => undefined,
    findById: async () => null,
    list: async () => ({ items: [] }),
    toWire: () => ({}) as never,
  };

  const verifier: AnthropicVerifier = {
    audit:
      verifierImpl ??
      (async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { verdict: 'supported', evidenceText: 'ok' };
      }),
  };

  const deps: LintRuntimeDeps = {
    verifier,
    claims: { listClaimsForWiki: async () => claims, listWikiIds: async () => [wid] },
    sourceText: { readSlice: async () => 'sample' },
    runs,
    findings,
    dispatcher: { start: async () => undefined, subscribe: () => emptyAsync() },
    eventBus: new InMemoryEventBus(),
    newId: () => {
      const idHex = (counter++).toString(16).padStart(12, '0');
      return `88888888-2222-4333-8444-${idHex}`;
    },
    now: () => new Date('2026-05-09T12:00:00.000Z'),
    emit: async (e) => {
      emitted.push(e);
    },
    concurrency: 6,
  };

  return { deps, emitted, inserted, runUpdates, peakConcurrency: () => peak };
};

const emptyAsync = async function* (): AsyncIterable<LintEvent> {
  // no events
};

describe('lintWiki', () => {
  it('emits LintRunStarted, ClaimAudited per claim, LintRunFinished', async () => {
    const r = fakeRuntime(buildClaims(3));
    await lintWiki(r.deps, { lintRunId: lid, wikiId: wid });
    const kinds = r.emitted.map((e) => e.kind);
    expect(kinds[0]).toBe('LintRunStarted');
    expect(kinds.filter((k) => k === 'ClaimAudited')).toHaveLength(3);
    expect(kinds[kinds.length - 1]).toBe('LintRunFinished');
  });

  it('caps concurrent Verifier calls at deps.concurrency (default 6)', async () => {
    const r = fakeRuntime(buildClaims(20));
    await lintWiki(r.deps, { lintRunId: lid, wikiId: wid });
    expect(r.peakConcurrency()).toBeLessThanOrEqual(6);
    expect(r.peakConcurrency()).toBeGreaterThan(1);
  });

  it('persists one LintFinding per Claim and tallies the LintRun', async () => {
    const r = fakeRuntime(buildClaims(4), async () => ({
      verdict: 'unsupported',
      evidenceText: 'gap',
      correction: { replacementText: 'fix' },
    }));
    const out = await lintWiki(r.deps, { lintRunId: lid, wikiId: wid });
    expect(r.inserted).toHaveLength(4);
    expect(out.unsupportedCount).toBe(4);
    expect(out.contradictedCount).toBe(0);
    expect(out.totalClaims).toBe(4);
    const finalRun = r.runUpdates.at(-1);
    expect(finalRun?.status).toBe('finished');
    expect(finalRun?.audited).toBe(4);
  });

  it('counts contradicted verdicts separately from unsupported', async () => {
    const r = fakeRuntime(buildClaims(3), async () => ({
      verdict: 'contradicted',
      evidenceText: 'mismatch',
      correction: { replacementText: 'fix' },
    }));
    const out = await lintWiki(r.deps, { lintRunId: lid, wikiId: wid });
    expect(out.contradictedCount).toBe(3);
    expect(out.unsupportedCount).toBe(0);
  });

  it('handles a wiki with zero claims (start → finish, no ClaimAudited)', async () => {
    const r = fakeRuntime(buildClaims(0));
    await lintWiki(r.deps, { lintRunId: lid, wikiId: wid });
    expect(r.emitted.map((e) => e.kind)).toEqual(['LintRunStarted', 'LintRunFinished']);
  });

  it('isolates per-claim audit failures: one bad claim becomes one finding, the run finishes', async () => {
    let call = 0;
    const r = fakeRuntime(buildClaims(3), async () => {
      call += 1;
      if (call === 2) throw new Error('verifier blew up');
      return { verdict: 'supported', evidenceText: 'ok' };
    });
    const out = await lintWiki(r.deps, { lintRunId: lid, wikiId: wid });
    expect(r.inserted).toHaveLength(3);
    expect(out.totalClaims).toBe(3);
    // The failed audit becomes an unsupported finding (with synthetic
    // Correction) rather than aborting the run. The final run is finished.
    const finalRun = r.runUpdates.at(-1);
    expect(finalRun?.status).toBe('finished');
    expect(out.unsupportedCount).toBe(1);
    const audited = r.emitted.filter((e) => e.kind === 'ClaimAudited');
    expect(audited).toHaveLength(3);
    expect(r.emitted.at(-1)?.kind).toBe('LintRunFinished');
  });
});

// Type-check helpers above use these so biome doesn't trim them.
void [
  null as unknown as ClaimId,
  null as unknown as LintFindingId,
  null as unknown as LintRunId,
  null as unknown as WikiId,
];
