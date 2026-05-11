import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { CompileTheater } from '../components/compile-theater/compile-theater.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { Button } from '../components/ui/button.tsx';
import { DeleteWikiButton } from '../components/wiki/delete-wiki-button.tsx';
import { WikiTreeSidebar } from '../components/wiki/wiki-tree-sidebar.tsx';
import { isBackendNotImplemented, useLiveMode } from '../lib/live-mode.tsx';
import { orpc } from '../lib/orpc.ts';

export function WikiRoute() {
  const { wikiId = '' } = useParams();
  const location = useLocation();
  // The picker hook seeds `state.compileRunId` so the CompileTheater
  // mounts on first paint instead of waiting for the user to click
  // "Compile this folder". We copy it into local state once on mount;
  // subsequent re-renders don't re-trigger the theater.
  const seededRunId =
    typeof (location.state as { compileRunId?: unknown } | null)?.compileRunId === 'string'
      ? (location.state as { compileRunId: string }).compileRunId
      : null;
  const [compileRunId, setCompileRunId] = useState<string | null>(seededRunId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: seed once on mount only; later re-renders to the same route shouldn't replay the theater.
  useEffect(() => {
    if (seededRunId && compileRunId === null) setCompileRunId(seededRunId);
  }, []);
  const { markUnavailable } = useLiveMode();

  const wiki = useQuery({
    ...orpc.wiki.getWiki.queryOptions({ input: { id: wikiId } }),
    enabled: !!wikiId,
  });
  const pages = useQuery({
    ...orpc.wiki.listPages.queryOptions({ input: { wikiId, limit: 100 } }),
    enabled: !!wikiId,
  });
  const folder = useQuery({
    ...orpc.ingestion.getFolder.queryOptions({ input: { id: wiki.data?.folderId ?? '' } }),
    enabled: !!wiki.data?.folderId,
  });

  const start = useMutation({
    ...orpc.wiki.startCompile.mutationOptions(),
    onSuccess: (data) => setCompileRunId(data.compileRunId),
    onError: (e) => {
      if (isBackendNotImplemented(e)) {
        markUnavailable('startCompile is not implemented in the current backend phase.');
      }
    },
  });

  const startCompile = () => {
    const folderId = wiki.data?.folderId;
    if (folderId) start.mutate({ folderId });
  };

  if (wiki.isPending) {
    return (
      <AppShell>
        <main className="mx-auto max-w-7xl px-6 py-8">
          <LoadingState rows={4} />
        </main>
      </AppShell>
    );
  }

  if (wiki.isError) {
    return (
      <AppShell>
        <main className="mx-auto max-w-7xl px-6 py-8">
          <ErrorState
            message={`Failed to load wiki: ${(wiki.error as Error).message}`}
            onRetry={() => wiki.refetch()}
          />
        </main>
      </AppShell>
    );
  }

  const pageCount = pages.data?.items.length ?? 0;
  const headline = folder.data?.name ?? 'Wiki';

  return (
    <AppShell>
      <div className="flex">
        <WikiTreeSidebar wikiId={wikiId} />
        <main className="min-w-0 flex-1 px-6 py-10 lg:px-10">
          <div className="mx-auto max-w-5xl space-y-10">
            <motion.header
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
            >
              <div className="space-y-3">
                <h1 className="font-serif text-5xl leading-tight tracking-tight">{headline}</h1>
                {wiki.data?.schema.thesis ? (
                  <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">
                    {wiki.data.schema.thesis}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {wiki.data?.schema.pageTypes.map((pt) => (
                    <motion.span
                      key={pt.name}
                      whileHover={{ y: -1 }}
                      className="rounded-full border border-accent/30 bg-accent/5 px-2.5 py-1 font-mono text-[10px] tracking-wider text-accent"
                    >
                      {pt.name}
                    </motion.span>
                  ))}
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {pageCount} {pageCount === 1 ? 'page' : 'pages'} compiled
                  {wiki.data?.lastCompiledAt
                    ? ` · last ${new Date(wiki.data.lastCompiledAt).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={pageCount === 0 ? 'accent' : 'outline'}
                  onClick={startCompile}
                  disabled={start.isPending}
                >
                  {start.isPending
                    ? 'Starting…'
                    : pageCount === 0
                      ? 'Compile this folder'
                      : 'Recompile'}
                </Button>
                <DeleteWikiButton wikiId={wikiId} folderName={folder.data?.name ?? 'this wiki'} />
              </div>
            </motion.header>

            {start.isError ? (
              <ErrorState
                message={`Compile didn't start: ${(start.error as Error).message}`}
                onRetry={startCompile}
              />
            ) : null}

            {compileRunId ? (
              <CompileTheater
                compileRunId={compileRunId}
                onRetry={() => {
                  setCompileRunId(null);
                  startCompile();
                }}
              />
            ) : null}

            {pages.isError ? (
              <ErrorState
                message={`Failed to load pages: ${(pages.error as Error).message}`}
                onRetry={() => pages.refetch()}
              />
            ) : (
              <motion.section
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.05 }}
                className="grid grid-cols-1 gap-x-8 gap-y-8 md:grid-cols-2"
              >
                {wiki.data?.schema.pageTypes.map((pt, idx) => (
                  <motion.div
                    key={pt.name}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: idx * 0.04 }}
                    className="rounded-md border border-border/40 bg-card/30 p-5"
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
                      {pt.name}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {pt.description}
                    </p>
                    <p className="mt-3 font-mono text-[10px] text-muted-foreground/70">
                      {pages.data?.items.filter((p) => p.pageType === pt.name).length ?? 0} pages
                    </p>
                  </motion.div>
                ))}
              </motion.section>
            )}
          </div>
        </main>
      </div>
    </AppShell>
  );
}
