import type { CompileEvent } from '@package/contracts/wiki';
import { motion } from 'framer-motion';

type AgentThought = Extract<CompileEvent, { kind: 'AgentThought' }>;

const AGENT_TINT: Record<AgentThought['agent'], string> = {
  Compiler: 'text-foreground',
  SchemaInferrer: 'text-accent',
  Researcher: 'text-emerald-600 dark:text-emerald-400',
  Drafter: 'text-violet-600 dark:text-violet-400',
  Linker: 'text-sky-600 dark:text-sky-400',
  IndexBuilder: 'text-amber-600 dark:text-amber-400',
};

/**
 * One line in the CompileTheater's Agents-lane narrative scroll. The
 * agent name is mono and tinted by role so the user can scan a long log
 * by color without reading every line; the message stays in the body
 * font for legibility.
 */
export function ThoughtLine({ thought }: { thought: AgentThought }) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="flex gap-2 text-xs leading-snug"
    >
      <span
        className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${AGENT_TINT[thought.agent]}`}
      >
        {thought.agent}
      </span>
      <span className="text-muted-foreground">{thought.message}</span>
    </motion.li>
  );
}
