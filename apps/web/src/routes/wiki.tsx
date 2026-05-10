import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CompileTheater } from '../components/compile-theater/compile-theater.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { ThemeToggle } from '../components/theme-toggle.tsx';
import { Button } from '../components/ui/button.tsx';
import { isBackendNotImplemented, useLiveMode } from '../lib/live-mode.tsx';
import { orpc } from '../lib/orpc.ts';

export function WikiRoute() {
  const { wikiId = '' } = useParams();
  const [compileRunId, setCompileRunId] = useState<string | null>(null);
  const { markUnavailable } = useLiveMode();

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

  const startMutate = start.mutate;
  useEffect(() => {
    if (!wikiId) return;
    startMutate({ folderId: wikiId });
  }, [wikiId, startMutate]);

  const wiki = useQuery({
    ...orpc.wiki.getWiki.queryOptions({ input: { id: wikiId } }),
    enabled: !!wikiId,
  });
  const pages = useQuery({
    ...orpc.wiki.listPages.queryOptions({ input: { wikiId, limit: 100 } }),
    enabled: !!wikiId,
  });

  if (wiki.isPending) return <LoadingState rows={4} />;

  // SF14 — getWiki errors used to leave the page rendering with a missing
  // header silently; surface the failure with a Retry button instead.
  if (wiki.isError) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <ErrorState
          message={`Failed to load wiki: ${(wiki.error as Error).message}`}
          onRetry={() => wiki.refetch()}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">{wiki.data?.folderId ?? wikiId}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            PageTypes:{' '}
            <span className="font-mono text-xs">
              {wiki.data?.schema.pageTypes.map((p) => p.name).join(' · ')}
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost">
            <Link to={`/chat/new?wikiId=${wikiId}`}>Chat</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={`/wiki/${wikiId}/lint`}>Lint</Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>

      {/* SF13 — startCompile errors used to be discarded; surface inline
          so the user understands why the theater never appears. */}
      {start.isError ? (
        <div className="mt-6">
          <ErrorState
            message={`Compile didn't start: ${(start.error as Error).message}`}
            onRetry={() => startMutate({ folderId: wikiId })}
          />
        </div>
      ) : null}

      {compileRunId ? (
        <CompileTheater
          compileRunId={compileRunId}
          onRetry={() => {
            setCompileRunId(null);
            startMutate({ folderId: wikiId });
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
  );
}
