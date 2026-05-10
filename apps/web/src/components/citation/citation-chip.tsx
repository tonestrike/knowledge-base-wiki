import type { Citation } from '@package/contracts/shared';
import { motion } from 'framer-motion';
import { useCitationFlight } from './use-citation-flight.tsx';

export interface CitationChipProps {
  citation: Citation;
}

/**
 * Cited-source chip. Subtle animated entry, hover lift, and a tap-press
 * that opens the source-preview modal. The earlier `layoutId` morph into
 * the modal looked broken with the modal at sm:max-w-3xl — the chip
 * stretched to fill the modal's width before fading out. We use a static
 * chip with a scale tap and let the modal animate independently.
 */
export function CitationChip({ citation }: CitationChipProps) {
  const { open } = useCitationFlight();
  return (
    <motion.button
      type="button"
      onClick={() => open(citation)}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.96 }}
      className="inline-flex max-w-full items-center gap-1.5 truncate whitespace-nowrap rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-mono text-[11px] text-accent shadow-[0_0_0_1px_transparent] transition-colors hover:border-accent hover:bg-accent/20 hover:text-foreground hover:shadow-[0_0_0_1px_rgba(0,0,0,0.04)]"
      title={citation.label}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
      <span className="truncate">{citation.label}</span>
    </motion.button>
  );
}
