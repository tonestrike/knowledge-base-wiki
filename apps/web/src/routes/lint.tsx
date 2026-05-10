import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { AuditProgress } from '../components/lint/audit-progress.tsx';
import { LintRibbon } from '../components/lint/lint-ribbon.tsx';
import { useLintStream } from '../components/lint/use-lint-stream.ts';
import { EmptyState } from '../components/states/empty.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { Button } from '../components/ui/button.tsx';
import { isBackendNotImplemented, useLiveMode } from '../lib/live-mode.tsx';
import { orpc } from '../lib/orpc.ts';

export function LintRoute() {
  const { wikiId = '' } = useParams();
  const qc = useQueryClient();
  const { markUnavailable } = useLiveMode();
  const [lintRunId, setLintRunId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const start = useMutation({
    ...orpc.verification.start.mutationOptions(),
    onSuccess: (data) => setLintRunId(data.lintRunId),
    onError: (e) => {
      if (isBackendNotImplemented(e)) {
        markUnavailable('verification.start is not implemented in the current backend phase.');
      }
    },
  });

  const findings = useQuery({
    ...orpc.verification.listFindings.queryOptions({
      input: { lintRunId: lintRunId ?? '', limit: 100 },
    }),
    enabled: !!lintRunId,
  });

  const apply = useMutation({
    ...orpc.verification.applyCorrection.mutationOptions(),
    onSuccess: () => {
      if (lintRunId) {
        qc.invalidateQueries({
          queryKey: orpc.verification.listFindings.key({ input: { lintRunId, limit: 100 } }),
        });
      }
    },
  });

  const stream = useLintStream(lintRunId);

  // Each ClaimAudited event means a new finding is persisted server-side —
  // pull it into the list view so it appears as the audit progresses.
  // We deliberately depend on `stream.events.length` (the lint rule isn't
  // happy with that, but invalidating on every count change is the point).
  const eventCount = stream.events.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to event count changes
  useEffect(() => {
    if (!lintRunId) return;
    qc.invalidateQueries({
      queryKey: orpc.verification.listFindings.key({ input: { lintRunId, limit: 100 } }),
    });
  }, [lintRunId, qc, eventCount]);

  const items = findings.data?.items ?? [];

  return (
    <AppShell>
      <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
        <motion.header
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="flex items-end justify-between gap-4"
        >
          <div>
            <h1 className="font-serif text-4xl tracking-tight">Lint</h1>
            <p className="mt-2 max-w-prose text-sm text-muted-foreground">
              Re-verify every claim against its cited source via Opus 4.7. Apply each suggested
              correction inline.
            </p>
          </div>
          <Button
            variant="accent"
            onClick={() => {
              setLintRunId(null);
              start.mutate({ wikiId });
            }}
            disabled={start.isPending}
          >
            {start.isPending ? 'Starting…' : lintRunId ? 'Re-run audit' : 'Run audit'}
          </Button>
        </motion.header>

        {start.isError ? <ErrorState message={(start.error as Error).message} /> : null}
        {stream.error ? (
          <ErrorState
            message={`Audit stream failed: ${stream.error}`}
            onRetry={() => {
              if (wikiId) start.mutate({ wikiId });
            }}
          />
        ) : null}

        {lintRunId ? (
          <AuditProgress events={stream.events} done={stream.done} failed={!!stream.error} />
        ) : null}

        {!lintRunId ? (
          <EmptyState
            title="No audit running"
            description='Click "Run audit" to verify every Claim against its cited Span via the Opus 4.7 Verifier.'
          />
        ) : items.length === 0 && !stream.done && !stream.error ? null : (
          <ul className="space-y-4">
            <AnimatePresence initial={false}>
              {items.map((f, i) => {
                const isApplying = applyingId === f.id && apply.isPending;
                const applyError =
                  applyingId === f.id && apply.isError ? (apply.error as Error).message : null;
                const isApplied = applyingId === f.id && apply.isSuccess;
                return (
                  <motion.li
                    key={f.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -16 }}
                    transition={{
                      type: 'spring',
                      stiffness: 240,
                      damping: 26,
                      delay: Math.min(i * 0.04, 0.4),
                    }}
                  >
                    <LintRibbon
                      finding={f}
                      applied={isApplied}
                      pending={isApplying}
                      errorMessage={applyError}
                      onApply={(id) => {
                        setApplyingId(id);
                        apply.mutate({ lintFindingId: id });
                      }}
                    />
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </main>
    </AppShell>
  );
}
