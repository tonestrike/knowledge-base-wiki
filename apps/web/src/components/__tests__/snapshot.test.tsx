import { afterEach, describe, expect, it } from 'bun:test';
import { mockTurn } from '@package/contracts/chat';
import { mockUnsupportedFinding } from '@package/contracts/verification';
import { mockWikiPage } from '@package/contracts/wiki';
import { cleanup, render } from '@testing-library/react';
import { AnswerSegmentView } from '../answer/answer-segment.tsx';
import { CitationFlightProvider } from '../citation/use-citation-flight.tsx';
import { CompileTheater } from '../compile-theater/compile-theater.tsx';
import { LintRibbon } from '../lint/lint-ribbon.tsx';
import { WikiPageView } from '../wiki-page/wiki-page.tsx';

describe('six spectacular elements render without throwing', () => {
  afterEach(() => {
    cleanup();
  });

  it('WikiPageView (magazine layout) renders title and citation chip', () => {
    const page = mockWikiPage();
    const { getByRole, getByText } = render(
      <CitationFlightProvider>
        <WikiPageView page={page} />
      </CitationFlightProvider>,
    );
    expect(getByRole('heading', { level: 1, name: page.title })).toBeTruthy();
    expect(getByText(/Q3 minutes/)).toBeTruthy();
  });

  it('CompileTheater renders three lanes', () => {
    const { getByText } = render(<CompileTheater />);
    expect(getByText('Sources')).toBeTruthy();
    expect(getByText('Agents')).toBeTruthy();
    expect(getByText('Pages')).toBeTruthy();
  });

  it('AnswerSegmentView renders each segment in mockTurn (artifact registry + citation chip + span shimmer)', () => {
    expect(() => {
      const segs = mockTurn().answer;
      for (const s of segs) {
        render(
          <CitationFlightProvider>
            <AnswerSegmentView segment={s} />
          </CitationFlightProvider>,
        );
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
