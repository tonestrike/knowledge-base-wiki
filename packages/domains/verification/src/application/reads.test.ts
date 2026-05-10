import { describe, expect, it } from 'bun:test';
import {
  citationId,
  claimId,
  contentHash,
  lintFindingId,
  lintRunId,
  sourceId,
  wikiId,
  wikiPageId,
} from '@package/contracts/shared';
import type { LintRunId, WikiId } from '@package/contracts/shared';
import type {
  LintFinding as LintFindingWire,
  LintRun as LintRunWire,
} from '@package/contracts/verification';
import { InMemoryEventBus } from '@package/shared-kernel';
import { Correction } from '../domain/correction.ts';
import { LintFinding } from '../domain/lint-finding.ts';
import { LintRun } from '../domain/lint-run.ts';
import { applyCorrection } from './apply-correction.ts';
import { getFinding } from './get-finding.ts';
import { getLintRun } from './get-lint-run.ts';
import { listFindings } from './list-findings.ts';
import { listLintRuns } from './list-lint-runs.ts';
import type { LintFindingRepository, LintRunRepository, VerificationDeps } from './ports.ts';

const RUN = lintRunId('77777777-2222-4333-8444-555555555555');
const RUN_OTHER = lintRunId('77777777-2222-4333-8444-666666666666');
const FINDING = lintFindingId('88888888-2222-4333-8444-000000000001');
const PAGE = wikiPageId('dddddddd-1111-4222-8333-444444444444');
const WIKI = wikiId('44444444-2222-4333-8444-555555555555');
const CLAIM = claimId('cccccccc-1111-4222-8333-444444444444');
const CIT = citationId('aaaaaaaa-1111-4222-8333-444444444444');
const SRC = sourceId('11111111-2222-4333-8444-000000000001');

const seedClaim = {
  id: CLAIM,
  wikiPageId: PAGE,
  paragraphId: 'p-1',
  claimText: 'NRR was 110%',
  citations: [
    {
      id: CIT,
      label: 'metrics',
      span: {
        sourceId: SRC,
        byteRange: { start: 0, end: 50 },
        contentHash: contentHash('sha256:abc'),
      },
    },
  ],
};

const unsupportedFinding = LintFinding.create({
  id: FINDING,
  lintRunId: RUN,
  wikiPageId: PAGE,
  claimId: CLAIM,
  claim: seedClaim,
  verdict: 'unsupported',
  evidenceText: 'cited slice does not mention NRR',
  citedSpans: seedClaim.citations,
  correction: Correction.create({ replacementText: 'NRR was 105%.' }),
});
const supportedFinding = LintFinding.create({
  id: lintFindingId('88888888-2222-4333-8444-000000000002'),
  lintRunId: RUN,
  wikiPageId: PAGE,
  claimId: CLAIM,
  claim: seedClaim,
  verdict: 'supported',
  evidenceText: 'matches.',
  citedSpans: seedClaim.citations,
});

const finishedRun = LintRun.finish(
  LintRun.run(
    LintRun.start({
      id: RUN,
      wikiId: WIKI,
      totalClaims: 2,
      startedAt: '2026-05-09T12:05:00.000Z',
    }),
  ),
  '2026-05-09T12:06:00.000Z',
);

const wireRun = (r: import('../domain/lint-run.ts').LintRun): LintRunWire => ({
  id: r.id,
  wikiId: r.wikiId,
  status: r.status,
  startedAt: r.startedAt,
  endedAt: r.endedAt,
  totalClaims: r.totalClaims,
  audited: r.audited,
  unsupportedCount: r.unsupportedCount,
  contradictedCount: r.contradictedCount,
});

const wireFinding = (f: LintFinding): LintFindingWire => ({
  id: f.id,
  lintRunId: f.lintRunId,
  wikiPageId: f.wikiPageId,
  claimId: f.claimId,
  claim: f.claim,
  verdict: f.verdict,
  evidenceText: f.evidenceText,
  citedSpans: [...f.citedSpans],
  correction: f.correction,
  resolvedAt: f.resolvedAt,
});

const buildDeps = (): {
  deps: VerificationDeps;
  bus: InMemoryEventBus;
  store: {
    findings: Map<string, LintFinding>;
    runs: Map<string, typeof finishedRun>;
  };
} => {
  const bus = new InMemoryEventBus();
  const findingsStore = new Map<string, LintFinding>([
    [unsupportedFinding.id, unsupportedFinding],
    [supportedFinding.id, supportedFinding],
  ]);
  const runsStore = new Map<string, typeof finishedRun>([[finishedRun.id, finishedRun]]);

  const findings: LintFindingRepository = {
    insertMany: async () => undefined,
    update: async (f) => {
      findingsStore.set(f.id, f);
    },
    findById: async (id) => findingsStore.get(id) ?? null,
    list: async ({ lintRunId, verdict, limit }) => {
      const items = [...findingsStore.values()].filter(
        (f) => f.lintRunId === lintRunId && (verdict ? f.verdict === verdict : true),
      );
      return { items: items.slice(0, limit) };
    },
    toWire: (f) => wireFinding(f),
  };

  const runs: LintRunRepository = {
    insert: async () => undefined,
    update: async () => undefined,
    findById: async (id) => runsStore.get(id) ?? null,
    list: async ({ wikiId, limit }) => {
      const items = [...runsStore.values()].filter((r) => (wikiId ? r.wikiId === wikiId : true));
      return { items: items.slice(0, limit) as never };
    },
    toWire: (r) => wireRun(r),
  };

  const deps: VerificationDeps = {
    verifier: { audit: async () => ({ verdict: 'supported', evidenceText: 'noop' }) },
    claims: { listClaimsForWiki: async () => [], listWikiIds: async () => [] },
    sourceText: { readSlice: async () => null },
    runs,
    findings,
    dispatcher: {
      start: async () => undefined,
      subscribe: async function* () {},
    },
    eventBus: bus,
    newId: () => 'unused-in-reads',
    now: () => new Date('2026-05-09T12:10:00.000Z'),
  };

  return { deps, bus, store: { findings: findingsStore, runs: runsStore } };
};

describe('applyCorrection', () => {
  it('marks the finding resolved and publishes CorrectionAccepted', async () => {
    const { deps, bus, store } = buildDeps();
    const seen: Array<{ name: string; payload: { replacementText: string } }> = [];
    bus.subscribe('CorrectionAccepted', (event) => {
      seen.push({ name: event.name, payload: { replacementText: event.payload.replacementText } });
    });
    const out = await applyCorrection(deps, { lintFindingId: unsupportedFinding.id });
    expect(out.appliedAt).toBe('2026-05-09T12:10:00.000Z');
    expect(store.findings.get(unsupportedFinding.id)?.resolvedAt).toBe('2026-05-09T12:10:00.000Z');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.name).toBe('CorrectionAccepted');
    expect(seen[0]?.payload.replacementText).toBe('NRR was 105%.');
  });

  it('refuses to apply a finding with no Correction (i.e. supported)', async () => {
    const { deps } = buildDeps();
    await expect(applyCorrection(deps, { lintFindingId: supportedFinding.id })).rejects.toThrow(
      /no Correction/,
    );
  });

  it('refuses to apply a finding that does not exist', async () => {
    const { deps } = buildDeps();
    const missing = lintFindingId('88888888-2222-4333-8444-000000000099');
    await expect(applyCorrection(deps, { lintFindingId: missing })).rejects.toThrow(
      /LintFinding not found/,
    );
  });

  it('refuses to apply a finding twice', async () => {
    const { deps } = buildDeps();
    await applyCorrection(deps, { lintFindingId: unsupportedFinding.id });
    await expect(applyCorrection(deps, { lintFindingId: unsupportedFinding.id })).rejects.toThrow(
      /already resolved/,
    );
  });

  it('does NOT mark resolved when the eventBus.publish rejects (consistency: publish-then-persist)', async () => {
    const { deps, store } = buildDeps();
    const failingBus: typeof deps.eventBus = {
      publish: async () => {
        throw new Error('queue down');
      },
      subscribe: () => () => undefined,
    };
    const failingDeps: typeof deps = { ...deps, eventBus: failingBus };
    await expect(
      applyCorrection(failingDeps, { lintFindingId: unsupportedFinding.id }),
    ).rejects.toThrow(/queue down/);
    // The finding must remain unresolved so the caller can retry.
    expect(store.findings.get(unsupportedFinding.id)?.resolvedAt).toBeUndefined();
  });
});

describe('getLintRun', () => {
  it('returns the wire form of the run', async () => {
    const { deps } = buildDeps();
    const out = await getLintRun(deps, { id: RUN });
    expect(out.id).toBe(RUN);
    expect(out.status).toBe('finished');
  });

  it('throws when not found', async () => {
    const { deps } = buildDeps();
    await expect(getLintRun(deps, { id: RUN_OTHER })).rejects.toThrow(/LintRun not found/);
  });
});

describe('listLintRuns', () => {
  it('lists runs and filters by wikiId', async () => {
    const { deps } = buildDeps();
    const all = await listLintRuns(deps, { limit: 10 });
    expect(all.items).toHaveLength(1);
    const filtered = await listLintRuns(deps, { wikiId: WIKI, limit: 10 });
    expect(filtered.items).toHaveLength(1);
    const otherWiki: WikiId = wikiId('44444444-2222-4333-8444-666666666666');
    const empty = await listLintRuns(deps, { wikiId: otherWiki, limit: 10 });
    expect(empty.items).toHaveLength(0);
  });
});

describe('getFinding', () => {
  it('returns the wire form', async () => {
    const { deps } = buildDeps();
    const out = await getFinding(deps, { id: unsupportedFinding.id });
    expect(out.id).toBe(unsupportedFinding.id);
    expect(out.verdict).toBe('unsupported');
  });

  it('throws when not found', async () => {
    const { deps } = buildDeps();
    await expect(
      getFinding(deps, { id: lintFindingId('88888888-2222-4333-8444-000000000099') }),
    ).rejects.toThrow(/LintFinding not found/);
  });
});

describe('listFindings', () => {
  it('lists findings and filters by verdict', async () => {
    const { deps } = buildDeps();
    const all = await listFindings(deps, { lintRunId: RUN, limit: 10 });
    expect(all.items.length).toBeGreaterThanOrEqual(2);
    const onlyUnsupported = await listFindings(deps, {
      lintRunId: RUN,
      verdict: 'unsupported',
      limit: 10,
    });
    expect(onlyUnsupported.items).toHaveLength(1);
    expect(onlyUnsupported.items[0]?.verdict).toBe('unsupported');
  });

  it('returns empty list for an unknown lintRunId', async () => {
    const { deps } = buildDeps();
    const out = await listFindings(deps, {
      lintRunId: lintRunId('77777777-2222-4333-8444-aaaaaaaaaaaa') as LintRunId,
      limit: 10,
    });
    expect(out.items).toHaveLength(0);
  });
});
