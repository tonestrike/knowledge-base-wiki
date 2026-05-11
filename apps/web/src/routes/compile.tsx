import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { CompileTheater } from '../components/compile-theater/compile-theater.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { orpc } from '../lib/orpc.ts';

/**
 * Stand-alone "your compile is happening right now" page.
 *
 * The picker on `/` navigates here the moment `wiki.startCompile` returns
 * a `compileRunId`, BEFORE the run has surfaced its `wikiId` (the wiki row
 * is inserted a few seconds in, after schema inference). The user gets
 * the dramatic CompileTheater + agent-thoughts narrative immediately
 * instead of staring at the picker waiting for a polling loop to flip.
 *
 * Once the CompileRun's `wikiId` is published we redirect to
 * `/wiki/<wikiId>` with `state.compileRunId` seeded so the wiki route's
 * theater picks up exactly where this page left off — same SSE subscription
 * id, no re-attach.
 */
export function CompileRoute() {
  const { compileRunId = '' } = useParams();
  const nav = useNavigate();

  const run = useQuery({
    ...orpc.wiki.getCompileRun.queryOptions({ input: { id: compileRunId } }),
    enabled: !!compileRunId,
    // Poll once a second until the wikiId arrives. The compile inserts
    // the wiki row right after schema inference (a few seconds in), so we
    // typically only spin here for a beat — the theater is what the user
    // is watching, not this query.
    refetchInterval: (q) => (q.state.data?.wikiId ? false : 1000),
  });

  // Don't auto-redirect once wikiId arrives — the cinematic finale (with
  // thesis preview + "Open your wiki" CTA inside CompileTheater) does the
  // hand-off. Auto-redirect would yank the user away mid-animation. The
  // CompileFinished branch in CompileTheater renders the navigate button.
  useEffect(() => {
    // Intentionally empty — left as a hook so the dev-time React state
    // doesn't strand the run id when we revisit this route.
    void run;
    void nav;
  }, [run, nav]);

  return (
    <AppShell>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {run.isError ? (
          <ErrorState
            message={`Couldn't subscribe to compile ${compileRunId.slice(0, 8)}: ${
              (run.error as Error).message
            }`}
            onRetry={() => run.refetch()}
          />
        ) : null}
        <CompileTheater compileRunId={compileRunId} />
      </main>
    </AppShell>
  );
}
