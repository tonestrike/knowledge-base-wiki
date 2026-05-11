import { motion, useReducedMotion } from 'framer-motion';

/**
 * Placeholder card for an in-flight Drafter call. Renders in the Pages
 * lane between a `Drafter — Drafting <PageType> page from N findings…`
 * AgentThought and the corresponding `PageDrafted` event. Pulses softly
 * so the user sees that work is happening even when individual drafter
 * calls take 10-30s each.
 *
 * Pure presentational — the parent (CompileTheater) decides how many
 * ghosts to mount based on Drafter thoughts vs landed PageDrafted
 * events, and replaces them with real `EmergingPage` cards as the
 * drafts come back.
 */
export function DraftingGhost({ pageType }: { pageType: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      className="relative overflow-hidden rounded-md border border-dashed border-accent/40 bg-accent/[0.03] p-3"
    >
      {!reduce ? (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-accent/15 to-transparent"
          initial={{ x: 0 }}
          animate={{ x: '300%' }}
          transition={{ repeat: Number.POSITIVE_INFINITY, duration: 2, ease: 'linear' }}
        />
      ) : null}
      <div className="relative">
        <p className="font-mono text-[10px] uppercase tracking-widest text-accent/70">{pageType}</p>
        <div className="mt-2 space-y-1.5">
          <motion.div
            className="h-2.5 w-3/4 rounded bg-muted-foreground/15"
            animate={reduce ? undefined : { opacity: [0.4, 0.8, 0.4] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.4, ease: 'easeInOut' }}
          />
          <motion.div
            className="h-2.5 w-1/2 rounded bg-muted-foreground/15"
            animate={reduce ? undefined : { opacity: [0.4, 0.8, 0.4] }}
            transition={{
              repeat: Number.POSITIVE_INFINITY,
              duration: 1.4,
              ease: 'easeInOut',
              delay: 0.2,
            }}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
          Drafting…
        </p>
      </div>
    </motion.div>
  );
}
