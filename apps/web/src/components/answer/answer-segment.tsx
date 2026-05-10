import type { AnswerSegment } from '@package/contracts/shared';
import { CitationChip } from '../citation/citation-chip.tsx';
import { ArtifactView } from './artifact-registry.tsx';
import { SpanShimmer, tokenizeProse } from './span-shimmer.tsx';

export function AnswerSegmentView({ segment }: { segment: AnswerSegment }) {
  if (segment.kind === 'prose') {
    return <SpanShimmer runs={tokenizeProse(segment.text)} />;
  }
  if (segment.kind === 'citation') return <CitationChip citation={segment.citation} />;
  return <ArtifactView artifact={segment.artifact} />;
}
