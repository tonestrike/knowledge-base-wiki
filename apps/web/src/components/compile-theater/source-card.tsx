import { motion } from 'framer-motion';

export function SourceCard({ id, name }: { id: string; name: string }) {
  return (
    <motion.div
      layoutId={`source-${id}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-md border border-border bg-background p-3 font-mono text-xs shadow-sm"
    >
      {name}
    </motion.div>
  );
}
