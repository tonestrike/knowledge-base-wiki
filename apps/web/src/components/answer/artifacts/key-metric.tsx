import type { Artifact } from '@package/contracts/shared';
import { CitationChip } from '../../citation/citation-chip.tsx';

type KeyMetricArtifact = Extract<Artifact, { kind: 'KeyMetric' }>;

export function KeyMetric({ artifact }: { artifact: KeyMetricArtifact }) {
  const { props, citations } = artifact;
  const c = props.citationId ? citations.find((x) => x.id === props.citationId) : undefined;
  const trendClass =
    props.trend === 'up'
      ? 'text-verdict-supported'
      : props.trend === 'down'
        ? 'text-verdict-contradicted'
        : '';
  return (
    <div className="rounded-lg border border-border p-6">
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        {props.label}
      </p>
      <p className="mt-2 font-serif text-5xl tracking-tight">{props.value}</p>
      {props.delta ? <p className={`mt-2 text-sm ${trendClass}`}>{props.delta}</p> : null}
      {c ? (
        <div className="mt-3">
          <CitationChip citation={c} />
        </div>
      ) : null}
    </div>
  );
}
