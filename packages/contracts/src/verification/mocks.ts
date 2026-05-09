import {
  citationId,
  claimId,
  lintFindingId,
  lintRunId,
  sourceId,
  wikiId,
  wikiPageId,
} from '../shared/ids.ts';
import type { LintFinding } from './findings.ts';
import type { LintEvent, LintRun } from './lints.ts';

const RUN = lintRunId('77777777-2222-4333-8444-555555555555');
const FINDING_OK = lintFindingId('88888888-2222-4333-8444-000000000001');
const FINDING_BAD = lintFindingId('88888888-2222-4333-8444-000000000002');
const PAGE = wikiPageId('dddddddd-1111-4222-8333-444444444444');
const WIKI = wikiId('44444444-2222-4333-8444-555555555555');
const CLAIM = claimId('cccccccc-1111-4222-8333-444444444444');
const CIT = citationId('aaaaaaaa-1111-4222-8333-444444444444');
const SRC = sourceId('11111111-2222-4333-8444-000000000001');

export const mockLintRun = (overrides: Partial<LintRun> = {}): LintRun => ({
  id: RUN,
  wikiId: WIKI,
  status: 'finished',
  startedAt: '2026-05-09T12:05:00.000Z',
  endedAt: '2026-05-09T12:06:30.000Z',
  totalClaims: 47,
  audited: 47,
  unsupportedCount: 1,
  contradictedCount: 0,
  ...overrides,
});

export const mockLintFinding = (overrides: Partial<LintFinding> = {}): LintFinding => ({
  id: FINDING_OK,
  lintRunId: RUN,
  wikiPageId: PAGE,
  claimId: CLAIM,
  claim: {
    id: CLAIM,
    wikiPageId: PAGE,
    paragraphId: 'p-2',
    claimText: 'The EMEA expansion was approved with a $2M budget cap.',
    citations: [
      {
        id: CIT,
        label: 'Q3 minutes, p.4',
        span: {
          sourceId: SRC,
          byteRange: { start: 1240, end: 1410 },
          contentHash: 'sha256:fixtureq3boardminutes',
        },
      },
    ],
  },
  verdict: 'supported',
  evidenceText: 'The board approved the EMEA expansion at the Q3 meeting with a $2M budget cap.',
  citedSpans: [
    {
      id: CIT,
      label: 'Q3 minutes, p.4',
      span: {
        sourceId: SRC,
        byteRange: { start: 1240, end: 1410 },
        contentHash: 'sha256:fixtureq3boardminutes',
      },
    },
  ],
  ...overrides,
});

export const mockUnsupportedFinding = (): LintFinding =>
  mockLintFinding({
    id: FINDING_BAD,
    verdict: 'unsupported',
    claim: {
      id: claimId('cccccccc-1111-4222-8333-000000000099'),
      wikiPageId: PAGE,
      paragraphId: 'p-5',
      claimText: 'Q3 NRR was 110%.',
      citations: [
        {
          id: CIT,
          label: 'Q3 minutes, p.4',
          span: {
            sourceId: SRC,
            byteRange: { start: 1240, end: 1410 },
            contentHash: 'sha256:fixtureq3boardminutes',
          },
        },
      ],
    },
    evidenceText: 'The cited span describes the EMEA decision; it does not mention NRR.',
    correction: {
      replacementText: 'Q3 NRR was 105%.',
      newCitationLabel: 'Q3 metrics deck, slide 7',
    },
  });

export async function* mockLintEventStream(): AsyncIterable<LintEvent> {
  yield { kind: 'LintRunStarted', lintRunId: RUN, totalClaims: 4 };
  yield {
    kind: 'ClaimAudited',
    lintRunId: RUN,
    lintFindingId: FINDING_OK,
    claimId: CLAIM,
    wikiPageId: PAGE,
    verdict: 'supported',
  };
  yield {
    kind: 'ClaimAudited',
    lintRunId: RUN,
    lintFindingId: lintFindingId('88888888-2222-4333-8444-000000000003'),
    claimId: claimId('cccccccc-1111-4222-8333-000000000050'),
    wikiPageId: PAGE,
    verdict: 'supported',
  };
  yield {
    kind: 'ClaimAudited',
    lintRunId: RUN,
    lintFindingId: FINDING_BAD,
    claimId: claimId('cccccccc-1111-4222-8333-000000000099'),
    wikiPageId: PAGE,
    verdict: 'unsupported',
  };
  yield {
    kind: 'ClaimAudited',
    lintRunId: RUN,
    lintFindingId: lintFindingId('88888888-2222-4333-8444-000000000004'),
    claimId: claimId('cccccccc-1111-4222-8333-000000000051'),
    wikiPageId: PAGE,
    verdict: 'supported',
  };
  yield {
    kind: 'LintRunFinished',
    lintRunId: RUN,
    unsupportedCount: 1,
    contradictedCount: 0,
  };
}
