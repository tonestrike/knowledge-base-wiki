import type { Citation } from '@package/contracts/shared';
import { motion } from 'framer-motion';
import { useCitationFlight } from './use-citation-flight.tsx';

export interface CitationChipProps {
  citation: Citation;
}

export function CitationChip({ citation }: CitationChipProps) {
  const { open } = useCitationFlight();
  return (
    <motion.button
      type="button"
      layoutId={`citation-${citation.id}`}
      onClick={() => open(citation)}
      className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent-foreground hover:bg-accent/20"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-accent" />
      {citation.label}
    </motion.button>
  );
}
