import type { Artifact, ArtifactKind } from '@package/contracts/shared';
import type { ComponentType } from 'react';
import { BarChart } from './artifacts/bar-chart.tsx';
import { CodeBlock } from './artifacts/code-block.tsx';
import { ComparisonTable } from './artifacts/comparison-table.tsx';
import { KeyMetric } from './artifacts/key-metric.tsx';
import { LineChart } from './artifacts/line-chart.tsx';
import { Markdown } from './artifacts/markdown.tsx';
import { Quote } from './artifacts/quote.tsx';
import { Timeline } from './artifacts/timeline.tsx';

type ArtifactComponent<K extends ArtifactKind> = ComponentType<{
  artifact: Extract<Artifact, { kind: K }>;
}>;

type Registry = { [K in ArtifactKind]: ArtifactComponent<K> };

export const ArtifactRegistry: Registry = {
  ComparisonTable,
  Timeline,
  LineChart,
  BarChart,
  KeyMetric,
  CodeBlock,
  Quote,
  Markdown,
};

export function ArtifactView({ artifact }: { artifact: Artifact }) {
  // Discriminated dispatch — TS narrows artifact.kind so each branch's
  // component matches. The `default` arm holds an `assertNever` so adding
  // a new ArtifactKind to the contract blocks at typecheck (TD3) instead
  // of falling through to a silent ComparisonTable rewrite or `undefined`.
  switch (artifact.kind) {
    case 'ComparisonTable':
      return <ComparisonTable artifact={artifact} />;
    case 'Timeline':
      return <Timeline artifact={artifact} />;
    case 'LineChart':
      return <LineChart artifact={artifact} />;
    case 'BarChart':
      return <BarChart artifact={artifact} />;
    case 'KeyMetric':
      return <KeyMetric artifact={artifact} />;
    case 'CodeBlock':
      return <CodeBlock artifact={artifact} />;
    case 'Quote':
      return <Quote artifact={artifact} />;
    case 'Markdown':
      return <Markdown artifact={artifact} />;
    default: {
      const _exhaustive: never = artifact;
      return _exhaustive;
    }
  }
}
