import { useMutation, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { orpc } from '../lib/orpc.ts';

/**
 * Ingest-in-progress page.
 *
 * The picker on `/` navigates here after `registerFolder` returns a
 * `folderId`. We immediately kick off `ingestFolder` (which walks Drive,
 * downloads each file, and extracts text into R2 + D1 Source rows) and
 * poll `listSources` once a second to surface progressive per-file
 * progress. Once `ingestFolder` resolves, we fire `startCompile` and
 * navigate to `/compile/<compileRunId>` so the user flows through
 * ingest → compile → wiki on three well-animated, sequential pages
 * instead of staring at a silent picker for 60+ seconds.
 *
 * The animated stack of paper-card placeholders grows as the source
 * count grows — visceral feedback that bytes are landing on the server.
 */
export function IngestRoute() {
  const { folderId = '' } = useParams();
  const nav = useNavigate();

  // Refs + state declared first so the `sources` query below can read
  // `hasIngestResolved` in its `refetchInterval` callback without hitting
  // the temporal dead zone — `useQuery`'s options object is evaluated
  // during render and dereferences the ref synchronously.
  const hasIngestResolved = useRef(false);
  const hasStartedIngest = useRef(false);
  const [phase, setPhase] = useState<'ingesting' | 'compiling' | 'error'>('ingesting');
  const [error, setError] = useState<Error | null>(null);

  const folder = useQuery({
    ...orpc.ingestion.getFolder.queryOptions({ input: { id: folderId } }),
    enabled: !!folderId,
  });

  // Poll-driven progress proxy: each Source row in `listSources` is one
  // file the api has finished downloading + extracting. There's no real
  // SSE for ingest yet (the contract has a `streamIngestEvents` slot but
  // the interface still serves the mock); polling at 1500 ms is plenty
  // for a UI animation and stays well clear of D1 rate limits.
  const sources = useQuery({
    ...orpc.ingestion.listSources.queryOptions({ input: { folderId, limit: 100 } }),
    enabled: !!folderId,
    refetchInterval: (q) =>
      // Keep polling while we haven't seen the ingest mutation resolve.
      q.state.data?.items.length !== undefined && hasIngestResolved.current ? false : 1500,
  });

  // Ingest is a single POST that doesn't return until every file is
  // downloaded + extracted, so it can take a long time. We dispatch it
  // exactly once on mount; downstream effects key off the mutation's
  // settled state, not its `isPending` flag (the latter flips back to
  // false on success and we'd lose the "phase=compiling" hand-off).
  const ingest = useMutation({ ...orpc.ingestion.ingestFolder.mutationOptions() });
  const compile = useMutation({ ...orpc.wiki.startCompile.mutationOptions() });

  // biome-ignore lint/correctness/useExhaustiveDependencies: fire-once on mount; not parameterized on identifiers that change.
  useEffect(() => {
    if (!folderId || hasStartedIngest.current) return;
    hasStartedIngest.current = true;
    (async () => {
      try {
        const ingested = await ingest.mutateAsync({ folderId });
        hasIngestResolved.current = true;
        if (ingested.sourceCount === 0) {
          throw new Error(
            'No documents in this folder could be read. Every file failed extraction (most often because the api lacks a PDF worker for that filetype). Try a folder with Google Docs / Slides / Sheets, or a different set of PDFs.',
          );
        }
        setPhase('compiling');
        const { compileRunId } = await compile.mutateAsync({ folderId });
        nav(`/compile/${compileRunId}`, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e : new Error(String(e)));
        setPhase('error');
      }
    })();
  }, []);

  const ingestedCount = sources.data?.items.length ?? 0;
  const folderName = folder.data?.name ?? 'your folder';

  if (phase === 'error') {
    const msg =
      error?.message ??
      ((ingest.error ?? compile.error) as Error | undefined)?.message ??
      'Ingest failed for an unknown reason.';
    return (
      <AppShell>
        <main className="mx-auto max-w-3xl px-6 py-16">
          <ErrorState message={msg} onRetry={() => nav('/')} />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-4xl space-y-10 px-6 py-12">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="space-y-2"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
            {phase === 'compiling' ? 'Starting compile' : 'Ingesting'}
          </p>
          <h1 className="font-serif text-4xl tracking-tight">
            {phase === 'compiling' ? 'Opening the compile theater…' : `Reading ${folderName}…`}
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {phase === 'compiling'
              ? `Ingest complete — ${ingestedCount} document${ingestedCount === 1 ? '' : 's'} in. Handing off to the compiler now.`
              : 'Downloading each file from Drive and extracting text + per-page byte offsets. Each card below is one file landing on the server.'}
          </p>
        </motion.header>

        <section className="space-y-4">
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              Sources ingested
            </p>
            <motion.p
              key={ingestedCount}
              initial={{ scale: 0.85 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              className="font-serif text-5xl tabular-nums tracking-tight"
            >
              {ingestedCount}
            </motion.p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            <AnimatePresence initial={false}>
              {(sources.data?.items ?? []).map((s, i) => (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: 10, rotate: i % 2 === 0 ? -1.5 : 1.5 }}
                  animate={{ opacity: 1, y: 0, rotate: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 220, damping: 24 }}
                  className="overflow-hidden rounded-md border border-border bg-card/60 px-3 py-2 shadow-xs"
                >
                  <p
                    className="truncate font-mono text-[10px] uppercase tracking-wider text-accent"
                    title={s.filename}
                  >
                    {s.filename}
                  </p>
                  <p className="mt-1 font-mono text-[9px] text-muted-foreground">
                    {s.pageCount !== undefined ? `${s.pageCount}p` : 'ingested'}
                  </p>
                </motion.div>
              ))}
            </AnimatePresence>
            {phase === 'ingesting' ? <ShimmerCard /> : null}
          </div>
        </section>
      </main>
    </AppShell>
  );
}

/** Placeholder card with a soft pulse so the grid always has the "next
 *  one is incoming" visual — keeps motion alive while we wait between
 *  poll responses. */
function ShimmerCard() {
  return (
    <motion.div
      initial={{ opacity: 0.4 }}
      animate={{ opacity: [0.4, 0.8, 0.4] }}
      transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      className="rounded-md border border-dashed border-border bg-card/30 px-3 py-2"
    >
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">…</p>
      <p className="mt-1 font-mono text-[9px] text-muted-foreground">downloading</p>
    </motion.div>
  );
}
