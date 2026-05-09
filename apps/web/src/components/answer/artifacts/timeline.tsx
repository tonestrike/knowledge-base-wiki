import type { Artifact } from '@package/contracts/shared';
import { CitationChip } from '../../citation/citation-chip.tsx';

type TimelineArtifact = Extract<Artifact, { kind: 'Timeline' }>;

export function Timeline({ artifact }: { artifact: TimelineArtifact }) {
  const { props, citations } = artifact;
  const byId = new Map<string, (typeof citations)[number]>(citations.map((c) => [c.id, c]));
  return (
    <ol className="relative ml-4 border-l border-border">
      {props.events.map((e, i) => {
        const c = e.citationId ? byId.get(e.citationId) : undefined;
        const key = `${e.at}-${e.label}-${i}`;
        return (
          <li key={key} className="ml-6 pb-6">
            <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-accent" />
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {e.at}
            </p>
            <p className="mt-1 font-serif text-lg">{e.label}</p>
            {e.description ? (
              <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
            ) : null}
            {c ? (
              <div className="mt-2">
                <CitationChip citation={c} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
