import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { CompileTheater } from '../components/compile-theater/compile-theater.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { Button } from '../components/ui/button.tsx';
import { isBackendNotImplemented, useLiveMode } from '../lib/live-mode.tsx';
import { orpc } from '../lib/orpc.ts';

export function WikiRoute() {
  const { wikiId = '' } = useParams();
  const [compileRunId, setCompileRunId] = useState<string | null>(null);
  const { markUnavailable } = useLiveMode();

  const wiki = useQuery({
    ...orpc.wiki.getWiki.queryOptions({ input: { id: wikiId } }),
    enabled: !!wikiId,
  });
  const pages = useQuery({
    ...orpc.wiki.listPages.queryOptions({ input: { wikiId, limit: 100 } }),
    enabled: !!wikiId,
  });

  const start = useMutation({
    ...orpc.wiki.startCompile.mutationOptions(),
    onSuccess: (data) => setCompileRunId(data.compileRunId),
    onError: (e) => {
      // SF5 — flip LiveMode → unavailable so the App-level banner offers
      // a fall-back to mocks rather than rendering an empty theater.
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

  // SF14 — getWiki errors used to leave the page rendering with a missing
  // header silently; surface the failure with a Retry button instead.
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

  return (
    <AppShell>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <header className="flex items-baseline justify-between">
          <div>
            <h1 className="font-serif text-3xl tracking-tight">Overview</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              PageTypes:{' '}
              <span className="font-mono text-xs">
                {wiki.data?.schema.pageTypes.map((p) => p.name).join(' · ')}
              </span>
            </p>
          </div>
          <Button
            variant={pageCount === 0 ? 'accent' : 'outline'}
            onClick={startCompile}
            disabled={start.isPending}
          >
            {start.isPending ? 'Starting…' : pageCount === 0 ? 'Compile this folder' : 'Recompile'}
          </Button>
        </header>

        {/* SF13 — startCompile errors used to be discarded; surface inline
          so the user understands why the theater never appears. */}
        {start.isError ? (
          <div className="mt-6">
            <ErrorState
              message={`Compile didn't start: ${(start.error as Error).message}`}
              onRetry={startCompile}
            />
          </div>
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

        {/* SF14 — listPages errors should not silently render an empty
          PageType column; show an inline error with retry. */}
        {pages.isError ? (
          <div className="mt-12">
            <ErrorState
              message={`Failed to load pages: ${(pages.error as Error).message}`}
              onRetry={() => pages.refetch()}
            />
          </div>
        ) : (
          <section className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {wiki.data?.schema.pageTypes.map((pt) => (
              <div key={pt.name}>
                <p className="font-mono text-xs uppercase tracking-widest text-accent">{pt.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{pt.description}</p>
                <ul className="mt-3 space-y-1">
                  {pages.data?.items
                    .filter((p) => p.pageType === pt.name)
                    .map((p) => (
                      <li key={p.id}>
                        <Link
                          to={`/wiki/${wikiId}/page/${p.id}`}
                          className="text-sm underline-offset-4 hover:text-accent hover:underline"
                        >
                          {p.title}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>
        )}
      </main>
    </AppShell>
  );
}
