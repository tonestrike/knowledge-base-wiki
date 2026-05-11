import { describe, expect, it } from 'bun:test';
import type { AnswerEvent } from '@package/contracts/chat';
import { citationId, contentHash, sourceId, turnId } from '@package/contracts/shared';
import type { Citation } from '@package/contracts/shared';
import type { Synthesizer, SynthesizerEvent } from './ports.ts';
import { synthesizeAnswer } from './synthesize-answer.ts';

const tid = turnId('66666666-2222-4333-8444-555555555555');

const citation = (id: string): Citation => ({
  id: citationId(id),
  label: 'metrics deck',
  span: {
    sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
    byteRange: { start: 0, end: 50 },
    contentHash: contentHash('sha256:abc'),
  },
});

const synthesizerOf = (events: SynthesizerEvent[]): Synthesizer => ({
  async *stream() {
    for (const e of events) yield e;
  },
});

const collect = async (gen: AsyncIterable<AnswerEvent>): Promise<AnswerEvent[]> => {
  const out: AnswerEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};

describe('synthesizeAnswer', () => {
  it('emits AnswerStarted, segments, AnswerFinished and verifies citations', async () => {
    const cit = citation('aaaaaaaa-1111-4222-8333-444444444444');
    const events = await collect(
      synthesizeAnswer(
        {
          synthesizer: synthesizerOf([
            {
              kind: 'segment',
              index: 0,
              segment: { kind: 'prose', text: 'Q3 NRR landed at 110%.' },
            },
            {
              kind: 'segment',
              index: 1,
              segment: {
                kind: 'artifact',
                artifact: {
                  kind: 'KeyMetric',
                  props: { label: 'Q3 NRR', value: '110%' },
                  citationIds: [cit.id],
                },
              },
            },
            { kind: 'segment', index: 2, segment: { kind: 'citation', citationId: cit.id } },
          ]),
          sourceHashes: {
            async verify() {
              return { ok: true };
            },
          },
        },
        {
          turnId: tid,
          question: 'Q?',
          findings: [{ quoteText: 'NRR 110%', citationIds: [cit.id], citations: [cit] }],
        },
      ),
    );

    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe('AnswerStarted');
    expect(kinds[kinds.length - 1]).toBe('AnswerFinished');
    expect(kinds.filter((k) => k === 'AnswerSegment').length).toBe(3);
  });

  it('forwards prose deltas without verification', async () => {
    const events = await collect(
      synthesizeAnswer(
        {
          synthesizer: synthesizerOf([
            { kind: 'proseDelta', segmentIndex: 0, textDelta: 'Q3 ' },
            { kind: 'proseDelta', segmentIndex: 0, textDelta: 'NRR' },
            { kind: 'segment', index: 0, segment: { kind: 'prose', text: 'Q3 NRR' } },
          ]),
          sourceHashes: {
            async verify() {
              return { ok: true };
            },
          },
        },
        { turnId: tid, question: 'Q?', findings: [] },
      ),
    );
    expect(events.filter((e) => e.kind === 'AnswerProseDelta')).toHaveLength(2);
  });

  it('resolves an abbreviated UUID prefix back to the matching known citation', async () => {
    // LLMs commonly emit `[[cite:528bee29]]` instead of the full UUID; the
    // synthesizer ports surface those as 8-char `citationId` strings. The
    // use-case should prefix-match against the known set and proceed.
    const full = 'aaaaaaaa-1111-4222-8333-444444444444';
    const cit = citation(full);
    const events = await collect(
      synthesizeAnswer(
        {
          synthesizer: synthesizerOf([
            { kind: 'segment', index: 0, segment: { kind: 'citation', citationId: 'aaaaaaaa' } },
          ]),
          sourceHashes: {
            async verify() {
              return { ok: true };
            },
          },
        },
        {
          turnId: tid,
          question: 'Q?',
          findings: [{ quoteText: 'NRR 110%', citationIds: [cit.id], citations: [cit] }],
        },
      ),
    );
    const seg = events.find((e) => e.kind === 'AnswerSegment');
    expect(seg).toBeDefined();
    if (seg && seg.kind === 'AnswerSegment' && seg.segment.kind === 'citation') {
      expect(seg.segment.citation.id).toBe(cit.id);
    }
    expect(events.find((e) => e.kind === 'AnswerFailed')).toBeUndefined();
  });

  it('drops an ambiguous citation marker silently rather than failing the answer', async () => {
    // Two citations sharing an 8-char prefix is astronomically unlikely
    // with v4 UUIDs, but if it ever happens we want to skip the marker
    // rather than kill the whole stream — soft-fail UX trade-off.
    const a = citation('11112222-aaaa-4222-8333-444444444444');
    const b = citation('11112222-bbbb-4222-8333-444444444444');
    const events = await collect(
      synthesizeAnswer(
        {
          synthesizer: synthesizerOf([
            { kind: 'segment', index: 0, segment: { kind: 'citation', citationId: '11112222' } },
            { kind: 'segment', index: 1, segment: { kind: 'prose', text: 'still here.' } },
          ]),
          sourceHashes: {
            async verify() {
              return { ok: true };
            },
          },
        },
        {
          turnId: tid,
          question: 'Q?',
          findings: [{ quoteText: 'x', citationIds: [a.id, b.id], citations: [a, b] }],
        },
      ),
    );
    expect(events.find((e) => e.kind === 'AnswerFailed')).toBeUndefined();
    expect(events.find((e) => e.kind === 'AnswerFinished')).toBeDefined();
    const segs = events.filter((e) => e.kind === 'AnswerSegment');
    // Only the prose segment survives; the citation was dropped.
    expect(segs).toHaveLength(1);
    if (segs[0] && segs[0].kind === 'AnswerSegment') {
      expect(segs[0].segment.kind).toBe('prose');
    }
  });

  it('drops an artifact whose every citation is unresolvable, but keeps the answer alive', async () => {
    const events = await collect(
      synthesizeAnswer(
        {
          synthesizer: synthesizerOf([
            {
              kind: 'segment',
              index: 0,
              segment: {
                kind: 'artifact',
                artifact: {
                  kind: 'KeyMetric',
                  props: { label: 'X', value: '1' },
                  citationIds: ['00000000-0000-4000-8000-000000000000'],
                },
              },
            },
            { kind: 'segment', index: 1, segment: { kind: 'prose', text: 'fallback prose.' } },
          ]),
          sourceHashes: {
            async verify() {
              return { ok: true };
            },
          },
        },
        { turnId: tid, question: 'Q?', findings: [] },
      ),
    );
    expect(events.find((e) => e.kind === 'AnswerFailed')).toBeUndefined();
    expect(events.find((e) => e.kind === 'AnswerFinished')).toBeDefined();
    // The artifact was dropped; only the prose survives.
    const segs = events.filter((e) => e.kind === 'AnswerSegment');
    expect(segs).toHaveLength(1);
  });

  it('aborts with AnswerFailed when the hash check fails', async () => {
    const cit = citation('aaaaaaaa-1111-4222-8333-444444444444');
    const events = await collect(
      synthesizeAnswer(
        {
          synthesizer: synthesizerOf([
            { kind: 'segment', index: 0, segment: { kind: 'citation', citationId: cit.id } },
          ]),
          sourceHashes: {
            async verify() {
              return { ok: false, reason: 'mismatch' };
            },
          },
        },
        {
          turnId: tid,
          question: 'Q?',
          findings: [{ quoteText: 'q', citationIds: [cit.id], citations: [cit] }],
        },
      ),
    );
    const failed = events.find((e) => e.kind === 'AnswerFailed');
    expect(failed).toBeDefined();
    if (failed && failed.kind === 'AnswerFailed') {
      expect(failed.message).toMatch(/hash/i);
    }
  });

  it('drops a malformed artifact (e.g. registry-shape violation) and keeps streaming', async () => {
    const cit = citation('aaaaaaaa-1111-4222-8333-444444444444');
    const events = await collect(
      synthesizeAnswer(
        {
          synthesizer: synthesizerOf([
            {
              kind: 'segment',
              index: 0,
              segment: {
                kind: 'artifact',
                artifact: {
                  kind: 'ComparisonTable',
                  // columns has only 1 entry — registry requires min(2)
                  props: { columns: ['only'], rows: [] },
                  citationIds: [cit.id],
                },
              },
            },
            { kind: 'segment', index: 1, segment: { kind: 'prose', text: 'after the bad table.' } },
          ]),
          sourceHashes: {
            async verify() {
              return { ok: true };
            },
          },
        },
        {
          turnId: tid,
          question: 'Q?',
          findings: [{ quoteText: 'q', citationIds: [cit.id], citations: [cit] }],
        },
      ),
    );
    expect(events.find((e) => e.kind === 'AnswerFailed')).toBeUndefined();
    expect(events.find((e) => e.kind === 'AnswerFinished')).toBeDefined();
    const segs = events.filter((e) => e.kind === 'AnswerSegment');
    expect(segs).toHaveLength(1);
  });
});
