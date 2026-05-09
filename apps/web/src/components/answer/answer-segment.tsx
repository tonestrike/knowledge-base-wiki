import type { AnswerSegment } from '@package/contracts/shared';
import { CitationChip } from '../citation/citation-chip.tsx';
import { ArtifactView } from './artifact-registry.tsx';
import { SpanShimmer } from './span-shimmer.tsx';

export function AnswerSegmentView({ segment }: { segment: AnswerSegment }) {
  if (segment.kind === 'prose') {
    return (
      <SpanShimmer>
        <p className="prose-magazine text-lg">{segment.text}</p>
      </SpanShimmer>
    );
  }
  if (segment.kind === 'citation') return <CitationChip citation={segment.citation} />;
  return <ArtifactView artifact={segment.artifact} />;
}
