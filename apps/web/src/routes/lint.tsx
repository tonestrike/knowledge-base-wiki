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
import { orpc } from '../lib/orpc.ts';

export function LintRoute() {
  const { wikiId = '' } = useParams();
  const qc = useQueryClient();
  const [lintRunId, setLintRunId] = useState<string | null>(null);

  const start = useMutation({
    ...orpc.verification.start.mutationOptions(),
    onSuccess: (data) => setLintRunId(data.lintRunId),
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
      ) : (findings.data?.items.length ?? 0) === 0 && !stream.done ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          auditing claims…
        </p>
      ) : (
        <ul className="space-y-4">
          {findings.data?.items.map((f) => (
            <li key={f.id}>
              <LintRibbon finding={f} onApply={(id) => apply.mutate({ lintFindingId: id })} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
