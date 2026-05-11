import { afterEach, describe, expect, it } from 'bun:test';
import { mockTurn } from '@package/contracts/chat';
import { mockUnsupportedFinding } from '@package/contracts/verification';
import { mockWiki, mockWikiPage } from '@package/contracts/wiki';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LiveModeProvider } from '../../lib/live-mode.tsx';
import { AnswerSegmentView } from '../answer/answer-segment.tsx';
import { tokenizeProse } from '../answer/span-shimmer.tsx';
import { CitationFlightProvider } from '../citation/use-citation-flight.tsx';
import { CompileTheater } from '../compile-theater/compile-theater.tsx';
import { FeaturedWikiHero } from '../featured-wiki-hero.tsx';
import { LintRibbon } from '../lint/lint-ribbon.tsx';
import { SignInCta } from '../sign-in-cta.tsx';
import { WikiPageView } from '../wiki-page/wiki-page.tsx';

const wrap = (ui: React.ReactNode) => (
  <MemoryRouter>
    <LiveModeProvider initial={{ kind: 'static' }}>
      <CitationFlightProvider>{ui}</CitationFlightProvider>
    </LiveModeProvider>
  </MemoryRouter>
);

describe('six spectacular elements render without throwing', () => {
  afterEach(() => {
    cleanup();
  });

  it('WikiPageView (magazine layout) renders title and citation chip', () => {
    const page = mockWikiPage();
    const { getByRole, getAllByText } = render(wrap(<WikiPageView page={page} />));
    expect(getByRole('heading', { level: 1, name: page.title })).toBeTruthy();
    // The citation appears in both the inline body (or orphans footer) and
    // the sidebar — assert at least one occurrence.
    expect(getAllByText(/Q3 minutes/).length).toBeGreaterThan(0);
  });

  it('CompileTheater renders three lanes', () => {
    const { getByText } = render(wrap(<CompileTheater compileRunId={null} />));
    expect(getByText('Sources')).toBeTruthy();
    expect(getByText('Live narration')).toBeTruthy();
    expect(getByText(/^Pages/)).toBeTruthy();
  });

  it('AnswerSegmentView renders each segment in mockTurn (artifact registry + citation chip + span shimmer)', () => {
    expect(() => {
      const segs = mockTurn().answer;
      for (const s of segs) {
        render(wrap(<AnswerSegmentView segment={s} />));
      }
    }).not.toThrow();
  });

  it('FeaturedWikiHero renders title, thesis blurb, page-type chips, and an Open wiki CTA', () => {
    const wiki = mockWiki({
      schema: {
        pageTypes: [
          { name: 'Decision', description: 'A decision.' },
          { name: 'Metric', description: 'A metric.' },
          { name: 'Person', description: 'A person.' },
          { name: 'Risk', description: 'A risk.' },
          { name: 'Source', description: 'A source.' },
          { name: 'Event', description: 'An event.' },
        ],
        relations: [],
        thesis:
          'Board decisions in 2026 hinged on EMEA expansion. The risk profile shifted in Q3 after the close.',
      },
    });
    const { getByText, queryByText, getAllByText, getByRole } = render(
      wrap(<FeaturedWikiHero wiki={wiki} />),
    );
    // First sentence only — second sentence must NOT render.
    expect(
      getAllByText(/Board decisions in 2026 hinged on EMEA expansion\./).length,
    ).toBeGreaterThan(0);
    expect(queryByText(/risk profile shifted in Q3/)).toBeNull();
    // First five chips render; sixth lives behind a "+N more" overflow.
    expect(getByText('Decision')).toBeTruthy();
    expect(getByText('Source')).toBeTruthy();
    expect(queryByText('Event')).toBeNull();
    expect(getByText(/\+1 more/)).toBeTruthy();
    // CTA link points to the wiki.
    const link = getByRole('link', { name: /Open wiki/i });
    expect(link.getAttribute('href')).toBe(`/wiki/${wiki.id}`);
  });

  it('FeaturedWikiHero falls back to a generic blurb when no thesis is present', () => {
    const wiki = mockWiki({
      schema: { pageTypes: [{ name: 'P', description: 'p' }], relations: [] },
    });
    const { getByText } = render(wrap(<FeaturedWikiHero wiki={wiki} />));
    expect(getByText(/anchored to the verbatim source bytes/)).toBeTruthy();
  });

  it('SignInCta renders the exact sign-in copy and a Google button', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { getByText, getByRole } = render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <SignInCta />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(
      getByText('Sign in with Google to compile your own folder into a typed, span-verified wiki.'),
    ).toBeTruthy();
    expect(getByRole('button', { name: /Sign in with Google/i })).toBeTruthy();
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
  const VALID_A = 'aaaaaaaa-1111-4222-8333-444444444444';
  const VALID_B = 'bbbbbbbb-1111-4222-8333-444444444444';

  it('returns a single plain run when no markers are present', () => {
    const runs = tokenizeProse('Q3 NRR landed at 110%.');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.kind).toBe('plain');
  });

  it('extracts cited runs from [[cite:id]]…[[/cite]] markers', () => {
    const runs = tokenizeProse(
      `Q3 NRR landed at [[cite:${VALID_A}]]110%[[/cite]], four points above target.`,
    );
    const cited = runs.filter((r) => r.kind === 'cited');
    expect(cited).toHaveLength(1);
    const first = cited[0];
    expect(first?.kind === 'cited' ? String(first.citationId) : null).toBe(VALID_A);
    expect(first?.text).toBe('110%');
  });

  it('handles multiple cited runs in a single segment', () => {
    const runs = tokenizeProse(
      `[[cite:${VALID_A}]]One[[/cite]] and [[cite:${VALID_B}]]two[[/cite]] cites.`,
    );
    expect(runs.filter((r) => r.kind === 'cited')).toHaveLength(2);
  });

  // SF11 — the malformed pathologies must surface as `broken` runs so
  // bad markers no longer silently disappear from the rendered prose.
  it('emits broken run for invalid (non-UUID) citation id', () => {
    const runs = tokenizeProse('foo [[cite:abc-123]]inner[[/cite]] bar');
    const broken = runs.find((r) => r.kind === 'broken');
    expect(broken).toBeTruthy();
    expect(broken?.text).toBe('inner');
  });

  it('emits broken run for unterminated cite marker', () => {
    const runs = tokenizeProse(`prefix [[cite:${VALID_A}]] no close tag here`);
    const broken = runs.find((r) => r.kind === 'broken');
    expect(broken).toBeTruthy();
  });

  it('emits broken run for empty cite content', () => {
    const runs = tokenizeProse(`prefix [[cite:${VALID_A}]][[/cite]] suffix`);
    const broken = runs.find((r) => r.kind === 'broken');
    expect(broken).toBeTruthy();
  });
});
