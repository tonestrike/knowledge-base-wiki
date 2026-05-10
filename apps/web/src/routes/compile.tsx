import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
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

  useEffect(() => {
    const wikiId = run.data?.wikiId;
    if (!wikiId) return;
    nav(`/wiki/${wikiId}`, { replace: true, state: { compileRunId } });
  }, [run.data?.wikiId, compileRunId, nav]);

  return (
    <AppShell>
      <main className="mx-auto max-w-7xl space-y-8 px-6 py-10">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-2"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
            Compile in progress
          </p>
          <h1 className="font-serif text-4xl tracking-tight">Building your wiki…</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Reading sources, inferring a schema, drafting pages, and resolving the link graph.
            You'll be taken to the wiki the moment its first pages land — usually 30–60s.
          </p>
        </motion.header>

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
