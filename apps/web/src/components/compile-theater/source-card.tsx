import { motion, useReducedMotion } from 'framer-motion';

export function SourceCard({
  id,
  name,
  status = 'queued',
}: {
  id: string;
  name: string;
  /** queued = waiting; reading = Researcher is on this source right now;
   *  done = at least one finding came back from this source. Drives the
   *  card's color, border-glow, and inline status chip. */
  status?: 'queued' | 'reading' | 'done';
}) {
  const reduce = useReducedMotion();
  const cardClass = (() => {
    if (status === 'reading') {
      return 'border-accent bg-accent/10 shadow-[0_0_24px_-4px_var(--accent)]';
    }
    if (status === 'done') {
      return 'border-accent/40 bg-accent/5';
    }
    return 'border-border bg-background';
  })();
  return (
    <motion.div
      layoutId={reduce ? undefined : `source-${id}`}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      className={`relative overflow-hidden rounded-md border p-3 font-mono text-xs shadow-xs transition-colors ${cardClass}`}
    >
      {/* When this source is being actively read, a soft accent sweep
          travels across the card to signal work. Pure CSS gradient
          translate, kept on its own layer (will-change: transform). */}
      {status === 'reading' && !reduce ? (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-accent/30 to-transparent"
          initial={{ x: 0 }}
          animate={{ x: '300%' }}
          transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.8, ease: 'linear' }}
        />
      ) : null}
      <div className="relative flex items-center justify-between gap-3">
        <span className="truncate">{name}</span>
        {status === 'reading' ? (
          <motion.span
            className="shrink-0 rounded-sm bg-accent/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent"
            animate={reduce ? undefined : { opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.4, ease: 'easeInOut' }}
          >
            Reading
          </motion.span>
        ) : status === 'done' ? (
          <span className="shrink-0 rounded-sm bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
            Done
          </span>
        ) : null}
      </div>
    </motion.div>
  );
}
