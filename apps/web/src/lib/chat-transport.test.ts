import { describe, expect, it } from 'bun:test';
import type { AnswerEvent } from '@package/contracts/chat';
import { citationId, contentHash, sourceId, turnId, wikiPageId } from '@package/contracts/shared';
import type { UIMessageChunk } from 'ai';
import type { TenexUIMessageDataParts } from './chat-message-types.ts';
import { __test__translateForTest } from './chat-transport.ts';

type TenexChunk = UIMessageChunk<unknown, TenexUIMessageDataParts>;

const TURN = turnId('66666666-2222-4333-8444-555555555555');
const PID = wikiPageId('dddddddd-1111-4222-8333-444444444444');
const CIT = citationId('aaaaaaaa-1111-4222-8333-444444444444');

const drive = (events: AnswerEvent[]): TenexChunk[] => {
  const out: TenexChunk[] = [];
  const fan = __test__translateForTest(TURN);
  for (const e of events) for (const c of fan(e)) out.push(c);
  for (const c of fan.flush()) out.push(c);
  return out;
};

describe('chat-transport translation table', () => {
  it('AnswerStarted opens the message and surfaces turn-meta', () => {
    const out = drive([{ kind: 'AnswerStarted', turnId: TURN }]);
    const types = out.map((c) => c.type);
    expect(types[0]).toBe('start');
    expect(types[1]).toBe('start-step');
    expect(types[2]).toBe('data-turn-meta');
  });

  it('WikiPageRetrieved emits both a data-part and a reasoning-delta', () => {
    const out = drive([
      { kind: 'AnswerStarted', turnId: TURN },
      {
        kind: 'WikiPageRetrieved',
        turnId: TURN,
        wikiPageId: PID,
        title: 'Q3 NRR',
        pageType: 'Concept',
        citationCount: 3,
      },
    ]);
    const data = out.find((c) => c.type === 'data-wiki-page-retrieved');
    expect(data).toBeDefined();
    if (data?.type !== 'data-wiki-page-retrieved') throw new Error('type narrow');
    expect(data.data.title).toBe('Q3 NRR');
    expect(data.data.citationCount).toBe(3);

    const reasoning = out.filter((c) => c.type === 'reasoning-delta');
    // One delta from ResearchStarted (none here), one from WikiPageRetrieved.
    expect(reasoning.length).toBeGreaterThanOrEqual(1);
    if (reasoning[0]?.type === 'reasoning-delta') {
      expect(reasoning[0].delta).toContain('Q3 NRR');
      expect(reasoning[0].delta).toContain('Concept');
    }
  });

  it('AnswerProseDelta emits one text-start then text-deltas, AnswerSegment closes', () => {
    const out = drive([
      { kind: 'AnswerStarted', turnId: TURN },
      { kind: 'AnswerProseDelta', turnId: TURN, segmentIndex: 0, textDelta: 'Hello ' },
      { kind: 'AnswerProseDelta', turnId: TURN, segmentIndex: 0, textDelta: 'world.' },
      {
        kind: 'AnswerSegment',
        turnId: TURN,
        index: 0,
        segment: { kind: 'prose', text: 'Hello world.' },
      },
      { kind: 'AnswerFinished', turnId: TURN },
    ]);
    const textChunks = out.filter(
      (c) => c.type === 'text-start' || c.type === 'text-delta' || c.type === 'text-end',
    );
    expect(textChunks.map((c) => c.type)).toEqual([
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
    ]);
    expect(out[out.length - 1]?.type).toBe('finish');
    expect(out[out.length - 2]?.type).toBe('finish-step');
  });

  it('AnswerSegment(prose) without prior deltas synthesises a single delta', () => {
    const out = drive([
      { kind: 'AnswerStarted', turnId: TURN },
      {
        kind: 'AnswerSegment',
        turnId: TURN,
        index: 0,
        segment: { kind: 'prose', text: 'No streaming here.' },
      },
      { kind: 'AnswerFinished', turnId: TURN },
    ]);
    const text = out.filter(
      (c) => c.type === 'text-start' || c.type === 'text-delta' || c.type === 'text-end',
    );
    expect(text.map((c) => c.type)).toEqual(['text-start', 'text-delta', 'text-end']);
    if (text[1]?.type === 'text-delta') expect(text[1].delta).toBe('No streaming here.');
  });

  it('AnswerSegment(citation) emits data-citation', () => {
    const out = drive([
      { kind: 'AnswerStarted', turnId: TURN },
      {
        kind: 'AnswerSegment',
        turnId: TURN,
        index: 0,
        segment: {
          kind: 'citation',
          citation: {
            id: CIT,
            label: 'Q3 minutes, p.4',
            span: {
              sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
              byteRange: { start: 0, end: 50 },
              contentHash: contentHash('sha256:abc'),
            },
          },
        },
      },
      { kind: 'AnswerFinished', turnId: TURN },
    ]);
    const cit = out.find((c) => c.type === 'data-citation');
    expect(cit).toBeDefined();
    if (cit?.type === 'data-citation') {
      expect(cit.data.label).toBe('Q3 minutes, p.4');
      expect(cit.data.span.byteRange.end).toBe(50);
    }
  });

  it('AnswerFailed closes open text-parts and surfaces error', () => {
    const out = drive([
      { kind: 'AnswerStarted', turnId: TURN },
      { kind: 'AnswerProseDelta', turnId: TURN, segmentIndex: 0, textDelta: 'half ' },
      { kind: 'AnswerFailed', turnId: TURN, message: 'tripwire: bad citation' },
    ]);
    // text-end MUST be emitted so the message is in a valid state
    const types = out.map((c) => c.type);
    expect(types).toContain('text-end');
    expect(types).toContain('error');
    expect(types[types.length - 1]).toBe('finish');
  });

  it('flushOnClose finishes a stream that drops without a terminal event', () => {
    const out = drive([
      { kind: 'AnswerStarted', turnId: TURN },
      { kind: 'AnswerProseDelta', turnId: TURN, segmentIndex: 0, textDelta: 'oops' },
      // no AnswerFinished / AnswerFailed — simulating connection drop.
    ]);
    const types = out.map((c) => c.type);
    expect(types).toContain('text-end');
    expect(types).toContain('error');
    expect(types[types.length - 1]).toBe('finish');
  });
});
