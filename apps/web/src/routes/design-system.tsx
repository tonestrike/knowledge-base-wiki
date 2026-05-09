import { mockTurn } from '@package/contracts/chat';
import type { Artifact, ArtifactKind } from '@package/contracts/shared';
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
import { Button } from '../components/ui/button.tsx';
import { WikiPageView } from '../components/wiki-page/wiki-page.tsx';

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

interface Section {
  name: string;
  node: ReactNode;
}

const sections: Section[] = [
  { name: 'WikiPage (magazine layout)', node: <WikiPageView page={mockWikiPage()} /> },
  { name: 'CompileTheater', node: <CompileTheater /> },
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
  return (
    <main className="mx-auto max-w-6xl space-y-16 px-6 py-12">
      <header>
        <h1 className="font-serif text-4xl">Design system</h1>
        <p className="mt-2 text-muted-foreground">
          Live render of every spectacular element against contract mocks.
        </p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Closed registry kinds: {Object.keys(ArtifactRegistry).sort().join(', ')}
        </p>
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
  const fixture = findArtifactFixture(kind);
  if (!fixture) {
    return <p className="text-sm text-muted-foreground">(no fixture; populate in 2.C mocks)</p>;
  }
  return <ArtifactView artifact={fixture} />;
}

function findArtifactFixture(kind: ArtifactKind): Artifact | undefined {
  const turn = mockTurn();
  for (const seg of turn.answer) {
    if (seg.kind === 'artifact' && seg.artifact.kind === kind) return seg.artifact;
  }
  return undefined;
}
