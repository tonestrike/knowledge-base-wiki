import { motion, useReducedMotion } from 'framer-motion';

export function SourceCard({ id, name }: { id: string; name: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layoutId={reduce ? undefined : `source-${id}`}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      className="rounded-md border border-border bg-background p-3 font-mono text-xs shadow-sm"
    >
      {name}
    </motion.div>
  );
}
