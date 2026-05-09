import type { ReactNode } from 'react';

export function SpanShimmer({ children }: { children: ReactNode }) {
  return <span className="span-shimmer">{children}</span>;
}
