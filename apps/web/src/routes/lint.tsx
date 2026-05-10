import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { LintRibbon } from '../components/lint/lint-ribbon.tsx';
import { useLintStream } from '../components/lint/use-lint-stream.ts';
import { EmptyState } from '../components/states/empty.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { ThemeToggle } from '../components/theme-toggle.tsx';
import { Button } from '../components/ui/button.tsx';
import { isBackendNotImplemented, useLiveMode } from '../lib/live-mode.tsx';
import { orpc } from '../lib/orpc.ts';

export function LintRoute() {
  const { wikiId = '' } = useParams();
  const qc = useQueryClient();
  const { markUnavailable } = useLiveMode();
  const [lintRunId, setLintRunId] = useState<string | null>(null);
  // Track which finding is currently being applied so each ribbon can
  // surface its own pending / error state without sharing a global
  // mutation collapse animation (SF7).
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

  // Subscribe to events; on each ClaimAudited we invalidate so new findings show.
  const stream = useLintStream(lintRunId);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">Lint</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run an Opus verifier audit across every cited Claim. Apply each correction inline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="accent"
            onClick={() => start.mutate({ wikiId })}
            disabled={start.isPending}
          >
            {start.isPending ? 'Starting…' : 'Run audit'}
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {start.isError ? <ErrorState message={(start.error as Error).message} /> : null}

      {/* SF3 — surface stream-level failures. Without this the dashboard
          showed a phantom "auditing claims…" spinner forever on
          LintRunFailed or premature SSE close. */}
      {stream.error ? (
        <ErrorState
          message={`Audit stream failed: ${stream.error}`}
          onRetry={() => {
            // Re-running the start mutation issues a fresh lintRunId and
            // resubscribes the SSE hook with a clean state.
            if (wikiId) start.mutate({ wikiId });
          }}
        />
      ) : null}

      {!lintRunId ? (
        <EmptyState
          title="No audit running"
          description='Click "Run audit" to verify every Claim against its cited Span.'
        />
      ) : findings.isPending ? (
        <LoadingState rows={3} />
      ) : findings.isError ? (
        <ErrorState
          message={(findings.error as Error).message}
          onRetry={() => findings.refetch()}
        />
      ) : (findings.data?.items.length ?? 0) === 0 && !stream.done && !stream.error ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          auditing claims…
        </p>
      ) : (
        <ul className="space-y-4">
          {findings.data?.items.map((f) => {
            const isApplying = applyingId === f.id && apply.isPending;
            const applyError =
              applyingId === f.id && apply.isError ? (apply.error as Error).message : null;
            const isApplied = applyingId === f.id && apply.isSuccess;
            return (
              <li key={f.id}>
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
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
