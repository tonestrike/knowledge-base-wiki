import { describe, expect, it } from 'bun:test';
import type { LintRunId, WikiId } from '@package/contracts/shared';
import { wikiId } from '@package/contracts/shared';
import { InMemoryEventBus } from '@package/shared-kernel';
import type { VerificationDeps } from '../application/ports.ts';
import { dailyLintSample } from './cron-sample-lint.ts';

const buildDeps = (
  ids: WikiId[],
  startedWithId: (args: { lintRunId: LintRunId; wikiId: WikiId }) => void,
): VerificationDeps => {
  let counter = 0;
  return {
    verifier: { audit: async () => ({ verdict: 'supported', evidenceText: 'ok' }) },
    claims: { listClaimsForWiki: async () => [], listWikiIds: async () => ids },
    sourceText: { readSlice: async () => null },
    runs: {
      insert: async () => undefined,
      update: async () => undefined,
      findById: async () => null,
      list: async () => ({ items: [] }),
      toWire: () => ({}) as never,
    },
    findings: {
      insertMany: async () => undefined,
      update: async () => undefined,
      findById: async () => null,
      list: async () => ({ items: [] }),
      toWire: () => ({}) as never,
    },
    dispatcher: {
      start: async (args) => startedWithId(args),
      subscribe: async function* () {},
    },
    eventBus: new InMemoryEventBus(),
    newId: () => {
      const idHex = (counter++).toString(16).padStart(12, '0');
      return `77777777-2222-4333-8444-${idHex}`;
    },
    now: () => new Date('2026-05-09T06:00:00.000Z'),
  };
};

const ids = (n: number): WikiId[] =>
  Array.from({ length: n }).map((_, i) =>
    wikiId(`44444444-2222-4333-8444-${i.toString(16).padStart(12, '0')}`),
  );

describe('dailyLintSample', () => {
  it('schedules 10% of known wikis (default), at least 1', async () => {
    const started: WikiId[] = [];
    const deps = buildDeps(ids(20), ({ wikiId }) => started.push(wikiId));
    const out = await dailyLintSample(deps, { random: () => 0.5 });
    expect(out.scheduled).toBe(2);
    expect(out.failed).toBe(0);
    expect(started).toHaveLength(2);
  });

  it('schedules at least one wiki even at small populations', async () => {
    const started: WikiId[] = [];
    const deps = buildDeps(ids(3), ({ wikiId }) => started.push(wikiId));
    const out = await dailyLintSample(deps, { random: () => 0.5 });
    expect(out.scheduled).toBe(1);
    expect(out.failed).toBe(0);
  });

  it('returns 0 when there are no wikis', async () => {
    const deps = buildDeps([], () => undefined);
    const out = await dailyLintSample(deps);
    expect(out.scheduled).toBe(0);
    expect(out.failed).toBe(0);
  });

  it('honours a custom sampleFraction', async () => {
    const started: WikiId[] = [];
    const deps = buildDeps(ids(20), ({ wikiId }) => started.push(wikiId));
    const out = await dailyLintSample(deps, { sampleFraction: 0.5, random: () => 0.5 });
    expect(out.scheduled).toBe(10);
    expect(out.failed).toBe(0);
  });

  it('isolates per-wiki dispatcher failures and surfaces a failed count', async () => {
    let counter = 0;
    const deps: VerificationDeps = {
      ...buildDeps(ids(10), () => undefined),
      dispatcher: {
        start: async () => {
          // Reject every other dispatch.
          if (counter++ % 2 === 0) throw new Error('boom');
        },
        subscribe: async function* () {},
      },
    };
    const out = await dailyLintSample(deps, { random: () => 0.5 });
    expect(out.scheduled + out.failed).toBe(1);
    expect(out.failed).toBeGreaterThanOrEqual(0);
  });
});
