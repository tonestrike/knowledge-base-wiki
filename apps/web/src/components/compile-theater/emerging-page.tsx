import type { CompileEvent } from '@package/contracts/wiki';
import { motion, useReducedMotion } from 'framer-motion';

type PageDraftedEvent = Extract<CompileEvent, { kind: 'PageDrafted' }>;

export function EmergingPage({ event }: { event: PageDraftedEvent }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layoutId={reduce ? undefined : `page-${event.pageId}`}
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      className="rounded-md border border-accent/50 bg-accent/5 p-3 shadow-xs"
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
        {event.pageType ?? event.subtype}
      </p>
      <p className="mt-1 font-serif text-sm leading-snug">{event.title}</p>
    </motion.div>
  );
}
