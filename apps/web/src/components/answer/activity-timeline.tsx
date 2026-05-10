import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';

export type Phase = 'asking' | 'researching' | 'synthesizing' | 'finished' | 'failed';

interface PhaseSpec {
  id: Phase;
  label: string;
  hint: string;
}

const PHASES: PhaseSpec[] = [
  { id: 'asking', label: 'Question received', hint: 'queueing the turn' },
  { id: 'researching', label: 'Researcher', hint: 'searching wiki pages for grounded findings' },
  { id: 'synthesizing', label: 'Synthesizer', hint: 'composing the answer in segments' },
  { id: 'finished', label: 'Finished', hint: 'answer ready' },
];

const PHASE_INDEX: Record<Phase, number> = {
  asking: 0,
  researching: 1,
  synthesizing: 2,
  finished: 3,
  failed: 3,
};

export function ActivityTimeline({
  phase,
  durationMs,
  segmentCount,
  errorMessage,
  modelName,
}: {
  phase: Phase;
  durationMs: number;
  segmentCount: number;
  errorMessage: string | null;
  modelName?: string;
}) {
  const idx = PHASE_INDEX[phase];
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {PHASES.map((p, i) => {
        const state =
          phase === 'failed' && i === 3
            ? 'failed'
            : i < idx
              ? 'done'
              : i === idx
                ? 'active'
                : 'pending';
        return (
          <li key={p.id}>
            <PhaseCard
              spec={p}
              state={state as 'pending' | 'active' | 'done' | 'failed'}
              extra={
                p.id === 'synthesizing' && state === 'active' ? (
                  <SegmentCounter count={segmentCount} />
                ) : p.id === 'finished' && state === 'done' ? (
                  <DurationLabel ms={durationMs} />
                ) : p.id === 'finished' && state === 'failed' ? (
                  <span className="font-mono text-[10px] text-destructive">
                    {errorMessage ?? 'failed'}
                  </span>
                ) : p.id === 'researching' && i === idx && modelName ? (
                  <span className="font-mono text-[10px] text-muted-foreground">{modelName}</span>
                ) : null
              }
            />
          </li>
        );
      })}
    </ol>
  );
}

function PhaseCard({
  spec,
  state,
  extra,
}: {
  spec: PhaseSpec;
  state: 'pending' | 'active' | 'done' | 'failed';
  extra: ReactNode;
}) {
  const tone =
    state === 'done'
      ? 'border-accent/40 bg-accent/5 text-foreground'
      : state === 'active'
        ? 'border-accent/80 bg-accent/15 text-foreground shadow-[0_0_24px_rgba(255,165,0,0.15)]'
        : state === 'failed'
          ? 'border-destructive/60 bg-destructive/10 text-foreground'
          : 'border-border/60 bg-card/30 text-muted-foreground';
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`rounded-md border px-3 py-2.5 transition-colors ${tone}`}
    >
      <div className="flex items-center gap-2">
        <PhaseDot state={state} />
        <p className="font-mono text-[11px] uppercase tracking-widest">{spec.label}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{spec.hint}</p>
      {extra ? <div className="mt-1.5">{extra}</div> : null}
    </motion.div>
  );
}

function PhaseDot({ state }: { state: 'pending' | 'active' | 'done' | 'failed' }) {
  if (state === 'active') {
    return (
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
    );
  }
  if (state === 'done') return <span className="inline-block h-2 w-2 rounded-full bg-accent/80" />;
  if (state === 'failed')
    return <span className="inline-block h-2 w-2 rounded-full bg-destructive" />;
  return <span className="inline-block h-2 w-2 rounded-full border border-border" />;
}

function SegmentCounter({ count }: { count: number }) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        key={count}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.15 }}
        className="font-mono text-[10px] text-accent"
      >
        {count} segment{count === 1 ? '' : 's'} streamed
      </motion.span>
    </AnimatePresence>
  );
}

function DurationLabel({ ms }: { ms: number }) {
  const seconds = (ms / 1000).toFixed(1);
  return <span className="font-mono text-[10px] text-muted-foreground">{seconds}s</span>;
}
