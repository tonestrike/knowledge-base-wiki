import { afterEach, describe, expect, it } from 'bun:test';
import { mockTurn } from '@package/contracts/chat';
import { mockUnsupportedFinding } from '@package/contracts/verification';
import { mockWikiPage } from '@package/contracts/wiki';
import { cleanup, render } from '@testing-library/react';
import { LiveModeProvider } from '../../lib/live-mode.tsx';
import { AnswerSegmentView } from '../answer/answer-segment.tsx';
import { tokenizeProse } from '../answer/span-shimmer.tsx';
import { CitationFlightProvider } from '../citation/use-citation-flight.tsx';
import { CompileTheater } from '../compile-theater/compile-theater.tsx';
import { LintRibbon } from '../lint/lint-ribbon.tsx';
import { WikiPageView } from '../wiki-page/wiki-page.tsx';

const wrap = (ui: React.ReactNode) => (
  <LiveModeProvider initial={false}>
    <CitationFlightProvider>{ui}</CitationFlightProvider>
  </LiveModeProvider>
);

describe('six spectacular elements render without throwing', () => {
  afterEach(() => {
    cleanup();
  });

  it('WikiPageView (magazine layout) renders title and citation chip', () => {
    const page = mockWikiPage();
    const { getByRole, getByText } = render(wrap(<WikiPageView page={page} />));
    expect(getByRole('heading', { level: 1, name: page.title })).toBeTruthy();
    expect(getByText(/Q3 minutes/)).toBeTruthy();
  });

  it('CompileTheater renders three lanes', () => {
    const { getByText } = render(wrap(<CompileTheater compileRunId={null} />));
    expect(getByText('Sources')).toBeTruthy();
    expect(getByText('Agents')).toBeTruthy();
    expect(getByText('Pages')).toBeTruthy();
  });

  it('AnswerSegmentView renders each segment in mockTurn (artifact registry + citation chip + span shimmer)', () => {
    expect(() => {
      const segs = mockTurn().answer;
      for (const s of segs) {
        render(wrap(<AnswerSegmentView segment={s} />));
      }
    }).not.toThrow();
  });

  it('LintRibbon (unsupported finding) renders Apply correction button', () => {
    let applied = '';
    const f = mockUnsupportedFinding();
    const { getAllByText, getByRole } = render(
      <LintRibbon
        finding={f}
        onApply={(id) => {
          applied = id;
        }}
      />,
    );
    // Claim text appears twice — once as the claim, once in the correction diff (strikethrough).
    expect(getAllByText(f.claim.claimText).length).toBeGreaterThan(0);
    const button = getByRole('button', { name: /apply/i });
    button.click();
    expect(applied).toBe(f.id);
  });
});

describe('SpanShimmer span-scoping (spec §4.3 #6)', () => {
  it('returns a single plain run when no markers are present', () => {
    const runs = tokenizeProse('Q3 NRR landed at 110%.');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.citationId).toBeUndefined();
  });

  it('extracts cited runs from [[cite:id]]…[[/cite]] markers', () => {
    const runs = tokenizeProse(
      'Q3 NRR landed at [[cite:abc-123]]110%[[/cite]], four points above target.',
    );
    expect(runs.map((r) => r.text).join('')).toBe(
      'Q3 NRR landed at 110%, four points above target.',
    );
    const cited = runs.filter((r) => r.citationId);
    expect(cited).toHaveLength(1);
    expect(cited[0]?.citationId).toBe('abc-123');
    expect(cited[0]?.text).toBe('110%');
  });

  it('handles multiple cited runs in a single segment', () => {
    const runs = tokenizeProse('[[cite:a]]One[[/cite]] and [[cite:b]]two[[/cite]] cites.');
    expect(runs.filter((r) => r.citationId)).toHaveLength(2);
  });
});
