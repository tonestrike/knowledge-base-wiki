import type { CompileEvent } from '@package/contracts/wiki';
import { motion } from 'framer-motion';

type PageDraftedEvent = Extract<CompileEvent, { kind: 'PageDrafted' }>;

export function EmergingPage({ event }: { event: PageDraftedEvent }) {
  return (
    <motion.div
      layoutId={`page-${event.pageId}`}
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="rounded-md border border-accent/50 bg-accent/5 p-3"
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
        {event.pageType ?? event.subtype}
      </p>
      <p className="mt-1 font-serif text-sm">{event.title}</p>
    </motion.div>
  );
}
