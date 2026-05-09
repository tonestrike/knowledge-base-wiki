import type { AnswerSegment } from '../shared/artifact.ts';
import type { Citation } from '../shared/citation.ts';
import { citationId, conversationId, sourceId, turnId, userId, wikiId } from '../shared/ids.ts';
import type { AnswerEvent } from './answers.ts';
import type { Conversation } from './conversations.ts';
import type { Turn } from './turns.ts';

const CONV = conversationId('55555555-2222-4333-8444-555555555555');
const TURN = turnId('66666666-2222-4333-8444-555555555555');
const WIKI = wikiId('44444444-2222-4333-8444-555555555555');
const USER = userId('99999999-2222-4333-8444-555555555555');

const sampleCitation: Citation = {
  id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
  label: 'Q3 minutes, p.4',
  span: {
    sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
    byteRange: { start: 1240, end: 1410 },
    contentHash: 'sha256:fixtureq3boardminutes',
  },
};

const proseIntro: AnswerSegment = {
  kind: 'prose',
  text: 'Q3 NRR landed at 110%, four points above the 106% target.',
};
const tableSegment: AnswerSegment = {
  kind: 'artifact',
  artifact: {
    kind: 'ComparisonTable',
    props: {
      columns: ['Quarter', 'Target', 'Actual', 'Variance'],
      rows: [
        { cells: [{ value: 'Q1' }, { value: '102' }, { value: '101' }, { value: '-1' }] },
        { cells: [{ value: 'Q2' }, { value: '104' }, { value: '105' }, { value: '+1' }] },
        {
          cells: [
            { value: 'Q3' },
            { value: '106' },
            { value: '110', citationId: sampleCitation.id },
            { value: '+4' },
          ],
        },
      ],
    },
    citations: [sampleCitation],
  },
};
const citeSegment: AnswerSegment = { kind: 'citation', citation: sampleCitation };
const proseClose: AnswerSegment = {
  kind: 'prose',
  text: 'Trajectory is ahead of plan; Q4 target should be revisited.',
};

const sampleAnswer: AnswerSegment[] = [proseIntro, tableSegment, citeSegment, proseClose];

export const mockConversation = (overrides: Partial<Conversation> = {}): Conversation => ({
  id: CONV,
  wikiId: WIKI,
  userId: USER,
  title: 'Q3 NRR review',
  createdAt: '2026-05-09T12:00:00.000Z',
  ...overrides,
});

export const mockTurn = (overrides: Partial<Turn> = {}): Turn => ({
  id: TURN,
  conversationId: CONV,
  question: "What's our Q3 NRR trajectory and how does it compare to our targets?",
  answer: sampleAnswer,
  createdAt: '2026-05-09T12:00:01.000Z',
  finishedAt: '2026-05-09T12:00:04.500Z',
  ...overrides,
});

export async function* mockAnswerEventStream(): AsyncIterable<AnswerEvent> {
  yield { kind: 'AnswerStarted', turnId: TURN };
  yield { kind: 'AnswerSegment', turnId: TURN, index: 0, segment: proseIntro };
  yield { kind: 'AnswerSegment', turnId: TURN, index: 1, segment: tableSegment };
  yield { kind: 'AnswerSegment', turnId: TURN, index: 2, segment: citeSegment };
  yield { kind: 'AnswerSegment', turnId: TURN, index: 3, segment: proseClose };
  yield { kind: 'AnswerFinished', turnId: TURN };
}
