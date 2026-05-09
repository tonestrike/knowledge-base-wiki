import type { ReactNode } from 'react';

// TODO(2.E): scope shimmer to cited Spans inside the prose (spec §4.3 #6),
// not the whole paragraph. Needs the Drafter output tokenized into
// Span-anchored runs so we can wrap only the cited segments.
export function SpanShimmer({ children }: { children: ReactNode }) {
  return <span className="span-shimmer">{children}</span>;
}
