import { mockTurn } from '@package/contracts/chat';
import type { Artifact, ArtifactKind, Citation } from '@package/contracts/shared';
import { citationId, sourceId } from '@package/contracts/shared';
import { mockLintFinding, mockUnsupportedFinding } from '@package/contracts/verification';
import { mockWikiPage } from '@package/contracts/wiki';
import type { ReactNode } from 'react';
import { AnswerSegmentView } from '../components/answer/answer-segment.tsx';
import { ArtifactRegistry, ArtifactView } from '../components/answer/artifact-registry.tsx';
import { CompileTheater } from '../components/compile-theater/compile-theater.tsx';
import { LintRibbon } from '../components/lint/lint-ribbon.tsx';
import { EmptyState } from '../components/states/empty.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { NoResultsState } from '../components/states/no-results.tsx';
import { ThemeToggle } from '../components/theme-toggle.tsx';
import { Button } from '../components/ui/button.tsx';
import { WikiPageView } from '../components/wiki-page/wiki-page.tsx';
import { useLiveMode } from '../lib/live-mode.tsx';

const ARTIFACT_KINDS: ArtifactKind[] = [
  'ComparisonTable',
  'Timeline',
  'LineChart',
  'BarChart',
  'KeyMetric',
  'CodeBlock',
  'Quote',
  'Markdown',
];

const FIXTURE_CITATION: Citation = {
  id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
  label: 'Q3 minutes, p.4',
  span: {
    sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
    byteRange: { start: 1240, end: 1410 },
    contentHash: 'sha256:fixtureq3boardminutes',
  },
};

const FIXTURE_DEMO_RUN_ID = '33333333-2222-4333-8444-555555555555';

interface Section {
  name: string;
  node: ReactNode;
}

const sections: Section[] = [
  { name: 'WikiPage (magazine layout)', node: <WikiPageView page={mockWikiPage()} /> },
  {
    name: 'CompileTheater (six lanes + schema reveal + flying source cards + emerging pages)',
    node: <CompileTheater compileRunId={FIXTURE_DEMO_RUN_ID} />,
  },
  {
    name: 'AnswerSegment — full streamed turn (prose + table + citation chip + span shimmer)',
    node: (
      <div className="space-y-4">
        {mockTurn().answer.map((seg, i) => (
          <AnswerSegmentView key={`seg-${i}-${seg.kind}`} segment={seg} />
        ))}
      </div>
    ),
  },
  {
    name: 'Span shimmer — span-anchored cited run inside a prose segment',
    node: (
      <AnswerSegmentView
        segment={{
          kind: 'prose',
          text: 'Q3 NRR landed at [[cite:aaaaaaaa-1111-4222-8333-444444444444]]110%[[/cite]], four points above the [[cite:aaaaaaaa-1111-4222-8333-444444444444]]106% target[[/cite]].',
        }}
      />
    ),
  },
  {
    name: 'LintRibbon — supported finding',
    node: <LintRibbon finding={mockLintFinding()} onApply={() => undefined} />,
  },
  {
    name: 'LintRibbon — unsupported finding with correction',
    node: <LintRibbon finding={mockUnsupportedFinding()} onApply={() => undefined} />,
  },
  {
    name: 'Artifact registry — every kind',
    node: (
      <div className="space-y-8">
        {ARTIFACT_KINDS.map((k) => (
          <div key={k}>
            <p className="mb-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {k}
            </p>
            <ArtifactDemo kind={k} />
          </div>
        ))}
      </div>
    ),
  },
  {
    name: 'States — empty / loading / error / no-results',
    node: (
      <div className="space-y-6">
        <EmptyState
          title="No folder yet"
          description="Connect a Drive folder to begin."
          action={<Button variant="accent">Connect Drive</Button>}
        />
        <LoadingState rows={3} />
        <ErrorState message="Couldn't reach Cloudflare Workers." onRetry={() => undefined} />
        <NoResultsState query="EMEA Q5" />
      </div>
    ),
  },
];

export function DesignSystemRoute() {
  const { live, setLive } = useLiveMode();
  return (
    <main className="mx-auto max-w-6xl space-y-16 px-6 py-12">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">Design system</h1>
          <p className="mt-2 text-muted-foreground">
            Live render of every spectacular element against contract mocks.
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            Closed registry kinds: {Object.keys(ArtifactRegistry).sort().join(', ')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
              className="accent-accent"
            />
            <span className="font-mono uppercase tracking-widest">
              {live ? 'live SSE' : 'static gallery'}
            </span>
          </label>
          <ThemeToggle />
        </div>
      </header>
      {sections.map((s) => (
        <section key={s.name}>
          <h2 className="mb-4 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {s.name}
          </h2>
          {s.node}
        </section>
      ))}
    </main>
  );
}

function ArtifactDemo({ kind }: { kind: ArtifactKind }) {
  const fixture = findArtifactFixture(kind) ?? synthesizeFixture(kind);
  return <ArtifactView artifact={fixture} />;
}

function findArtifactFixture(kind: ArtifactKind): Artifact | undefined {
  const turn = mockTurn();
  for (const seg of turn.answer) {
    if (seg.kind === 'artifact' && seg.artifact.kind === kind) return seg.artifact;
  }
  return undefined;
}

/**
 * Minimal fallbacks for kinds the contract mocks don't yet exercise. Keeps
 * the gallery exhaustive (eight kinds × at least one fixture each) so the
 * snapshot story doesn't regress when the registry is extended.
 */
function synthesizeFixture(kind: ArtifactKind): Artifact {
  const citations = [FIXTURE_CITATION];
  switch (kind) {
    case 'Timeline':
      return {
        kind: 'Timeline',
        props: {
          events: [
            { at: '2026-01-15', label: 'Plan circulated', description: 'Board reads pre-read.' },
            { at: '2026-02-03', label: 'Decision approved', citationId: FIXTURE_CITATION.id },
            { at: '2026-03-12', label: 'EMEA rollout begins' },
          ],
        },
        citations,
      };
    case 'LineChart':
      return {
        kind: 'LineChart',
        props: {
          xLabel: 'Quarter',
          yLabel: 'NRR (%)',
          series: [
            {
              name: 'Actual',
              points: [
                { x: 'Q1', y: 101 },
                { x: 'Q2', y: 105 },
                { x: 'Q3', y: 110, citationId: FIXTURE_CITATION.id },
              ],
            },
            {
              name: 'Target',
              points: [
                { x: 'Q1', y: 102 },
                { x: 'Q2', y: 104 },
                { x: 'Q3', y: 106 },
              ],
            },
          ],
        },
        citations,
      };
    case 'BarChart':
      return {
        kind: 'BarChart',
        props: {
          xLabel: 'Region',
          yLabel: 'Pipeline ($M)',
          bars: [
            { x: 'NA', y: 12.4 },
            { x: 'EMEA', y: 8.1, citationId: FIXTURE_CITATION.id },
            { x: 'APAC', y: 4.6 },
          ],
        },
        citations,
      };
    case 'KeyMetric':
      return {
        kind: 'KeyMetric',
        props: {
          label: 'Q3 NRR',
          value: '110%',
          delta: '+4 pts',
          trend: 'up',
          citationId: FIXTURE_CITATION.id,
        },
        citations,
      };
    case 'CodeBlock':
      return {
        kind: 'CodeBlock',
        props: {
          language: 'typescript',
          source: 'export const NRR = 1.10; // [[cite: Q3 minutes, p.4]]\n',
        },
        citations,
      };
    case 'Quote':
      return {
        kind: 'Quote',
        props: {
          text: 'EMEA expansion is approved with a $2M budget cap.',
          attribution: 'Board minutes, Q3',
          citationId: FIXTURE_CITATION.id,
        },
        citations,
      };
    case 'Markdown':
      return {
        kind: 'Markdown',
        props: {
          body: '## Decision\n\nApproved EMEA expansion with a **$2M budget cap**.\n\n- Board reviewed Q3 plan\n- 9 of 11 directors voted yes',
        },
        citations,
      };
    default:
      // ComparisonTable already comes from mockTurn(); fall through to a minimal table.
      return {
        kind: 'ComparisonTable',
        props: {
          columns: ['Metric', 'Value'],
          rows: [{ cells: [{ value: 'Q3 NRR' }, { value: '110%' }] }],
        },
        citations,
      };
  }
}
