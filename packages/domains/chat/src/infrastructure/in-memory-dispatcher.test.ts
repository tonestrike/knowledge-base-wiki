import { describe, expect, it } from 'bun:test';
import {
  citationId,
  contentHash,
  conversationId,
  sourceId,
  turnId,
  userId,
  wikiId,
  wikiPageId,
} from '@package/contracts/shared';
import type { Citation } from '@package/contracts/shared';
import { ask } from '../application/ask.ts';
import { openConversation } from '../application/open-conversation.ts';
import type { ChatDeps, Researcher, Synthesizer, SynthesizerEvent } from '../application/ports.ts';
import { makeFakeChatDeps } from '../application/test-support.ts';
import { createInMemoryDispatcher } from './in-memory-dispatcher.ts';

const cid = conversationId('55555555-2222-4333-8444-555555555555');
const tid = turnId('66666666-2222-4333-8444-555555555555');
const uid = userId('99999999-2222-4333-8444-555555555555');
const wid = wikiId('44444444-2222-4333-8444-555555555555');
const pid = wikiPageId('dddddddd-1111-4222-8333-444444444444');

const cit: Citation = {
  id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
  label: 'metrics deck',
  span: {
    sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
    byteRange: { start: 0, end: 50 },
    contentHash: contentHash('sha256:abc'),
  },
};

const synthEvents: SynthesizerEvent[] = [
  { kind: 'segment', index: 0, segment: { kind: 'prose', text: 'Q3 NRR landed at 110%.' } },
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
];

const researcher: Researcher = {
  async research() {
    return {
      pages: [{ id: pid, wikiId: wid, title: 'Q3 NRR', body: 'NRR was 110%.', citations: [cit] }],
      findings: [
        { wikiPageId: pid, quoteText: 'NRR was 110%.', citationIds: [cit.id], citations: [cit] },
      ],
    };
  },
};

const synthesizer: Synthesizer = {
  async *stream() {
    for (const e of synthEvents) yield e;
  },
};

const buildDeps = (): ChatDeps => {
  const base = makeFakeChatDeps({
    ids: [cid, tid],
    // Researcher LLM was dropped; researchQuestion now sources findings
    // straight from the wiki search. Seed the fake wikiReader with a page
    // that holds the citation the synthesizer will reference.
    wikiPages: [
      {
        id: pid,
        wikiId: wid,
        title: 'Q3 NRR',
        body: 'NRR was 110%.',
        citations: [cit],
      },
    ],
  });
  const dispatcher = createInMemoryDispatcher({
    researcher,
    synthesizer,
    sourceHashes: base.sourceHashes,
    conversations: base.conversations,
    turns: base.turns,
    eventBus: base.eventBus,
    wikiReader: base.wikiReader,
    now: base.now,
  });
  return { ...base, researcher, synthesizer, dispatcher };
};

const drain = async <T>(iter: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const e of iter) out.push(e);
  return out;
};

describe('createInMemoryDispatcher', () => {
  it('end-to-end: ask → research → synthesize → AnswerProduced + persisted Turn', async () => {
    const deps = buildDeps();
    await openConversation({ ...deps, currentUserId: uid }, { wikiId: wid });
    await ask(deps, { conversationId: cid, question: 'Q3 NRR?' });

    const events = await drain(deps.dispatcher.subscribe({ conversationId: cid, turnId: tid }));
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe('AnswerStarted');
    expect(kinds[kinds.length - 1]).toBe('AnswerFinished');
    expect(kinds.filter((k) => k === 'AnswerSegment').length).toBe(3);

    const turn = await deps.turns.findById(tid);
    expect(turn?.finishedAt).toBeDefined();
    expect(turn?.answer).toHaveLength(3);

    // AnswerProduced was published
    const published = (deps as ChatDeps & { _published: Array<{ name: string }> })._published;
    expect(published.some((p) => p.name === 'AnswerProduced')).toBe(true);
  });

  it('replays the tape for a late subscriber', async () => {
    const deps = buildDeps();
    await openConversation({ ...deps, currentUserId: uid }, { wikiId: wid });
    await ask(deps, { conversationId: cid, question: 'Q3 NRR?' });

    // Wait for the run to finish via subscribing once.
    await drain(deps.dispatcher.subscribe({ conversationId: cid, turnId: tid }));
    // Subscribe again; the tape should replay everything.
    const replayed = await drain(deps.dispatcher.subscribe({ conversationId: cid, turnId: tid }));
    expect(replayed[0]?.kind).toBe('AnswerStarted');
    expect(replayed[replayed.length - 1]?.kind).toBe('AnswerFinished');
  });
});
