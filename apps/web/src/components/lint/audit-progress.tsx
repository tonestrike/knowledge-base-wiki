import type { LintEvent } from '@package/contracts/verification';
import { motion } from 'framer-motion';

interface ProgressTotals {
  total: number;
  audited: number;
  supported: number;
  unsupported: number;
  contradicted: number;
}

const tally = (events: ReadonlyArray<LintEvent>): ProgressTotals => {
  let total = 0;
  let audited = 0;
  let supported = 0;
  let unsupported = 0;
  let contradicted = 0;
  for (const e of events) {
    if (e.kind === 'LintRunStarted') total = e.totalClaims;
    if (e.kind === 'ClaimAudited') {
      audited++;
      if (e.verdict === 'supported') supported++;
      else if (e.verdict === 'unsupported') unsupported++;
      else if (e.verdict === 'contradicted') contradicted++;
    }
  }
  return { total, audited, supported, unsupported, contradicted };
};

export function AuditProgress({
  events,
  done,
  failed,
}: {
  events: ReadonlyArray<LintEvent>;
  done: boolean;
  failed: boolean;
}) {
  const t = tally(events);
  const pct = t.total > 0 ? Math.min(100, (t.audited / t.total) * 100) : 0;
  const phaseLabel = failed
    ? 'Audit failed'
    : done
      ? 'Audit complete'
      : t.total === 0
        ? 'Starting Verifier…'
        : `Auditing claim ${Math.min(t.audited + 1, t.total)} of ${t.total}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-3 rounded-lg border border-border bg-card/40 p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            Verifier · Opus 4.7
          </p>
          <p className="mt-0.5 font-serif text-lg leading-tight">{phaseLabel}</p>
        </div>
        <div className="text-right font-mono text-[11px] text-muted-foreground">
          <p>
            <span className="text-foreground">{t.audited}</span>
            <span className="text-muted-foreground/50"> / {t.total}</span>
          </p>
          <p>{Math.round(pct)}%</p>
        </div>
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-muted/40">
        <motion.div
          className={`absolute inset-y-0 left-0 ${failed ? 'bg-destructive/70' : 'bg-accent'}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 150, damping: 24 }}
        />
        {!done && !failed ? (
          <motion.div
            className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent"
            animate={{ x: ['-100%', '400%'] }}
            transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1">
        <VerdictPill kind="supported" count={t.supported} />
        <VerdictPill kind="unsupported" count={t.unsupported} />
        <VerdictPill kind="contradicted" count={t.contradicted} />
      </div>
    </motion.div>
  );
}

function VerdictPill({
  kind,
  count,
}: {
  kind: 'supported' | 'unsupported' | 'contradicted';
  count: number;
}) {
  const tone =
    kind === 'supported'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : kind === 'unsupported'
        ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
        : 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  return (
    <motion.div
      animate={count > 0 ? { scale: [1, 1.05, 1] } : undefined}
      transition={{ duration: 0.3 }}
      className={`flex items-center justify-between rounded-md border px-3 py-1.5 font-mono text-[11px] ${tone}`}
    >
      <span className="uppercase tracking-widest">{kind}</span>
      <span className="text-base text-foreground">{count}</span>
    </motion.div>
  );
}
