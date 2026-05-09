import type { Artifact } from '@package/contracts/shared';
import { CitationChip } from '../../citation/citation-chip.tsx';

type QuoteArtifact = Extract<Artifact, { kind: 'Quote' }>;

export function Quote({ artifact }: { artifact: QuoteArtifact }) {
  const { props, citations } = artifact;
  const c = props.citationId ? citations.find((x) => x.id === props.citationId) : undefined;
  return (
    <figure className="border-l-4 border-accent pl-6">
      <blockquote className="font-serif text-2xl leading-snug">{props.text}</blockquote>
      {props.attribution || c ? (
        <figcaption className="mt-3 text-sm text-muted-foreground">
          {props.attribution}
          {c ? (
            <span className="ml-2">
              <CitationChip citation={c} />
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
