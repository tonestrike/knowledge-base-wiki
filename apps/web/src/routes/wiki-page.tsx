import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { WikiPageView } from '../components/wiki-page/wiki-page.tsx';
import { WikiTreeSidebar } from '../components/wiki/wiki-tree-sidebar.tsx';
import { orpc } from '../lib/orpc.ts';

export function WikiPageRoute() {
  const { wikiId = '', pageId = '' } = useParams();
  const page = useQuery({
    ...orpc.wiki.getPage.queryOptions({ input: { id: pageId } }),
    enabled: !!pageId,
  });

  if (page.isPending) {
    return (
      <AppShell>
        <div className="flex">
          <WikiTreeSidebar wikiId={wikiId} />
          <main className="min-w-0 flex-1 px-6 py-12">
            <LoadingState rows={6} />
          </main>
        </div>
      </AppShell>
    );
  }
  if (page.isError || !page.data) {
    return (
      <AppShell>
        <div className="flex">
          <WikiTreeSidebar wikiId={wikiId} />
          <main className="min-w-0 flex-1 px-6 py-12">
            <ErrorState
              message={(page.error as Error | null)?.message ?? 'Failed to load page.'}
              onRetry={() => page.refetch()}
            />
          </main>
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell trail={[{ label: page.data.title }]}>
      <div className="flex">
        <WikiTreeSidebar wikiId={wikiId} />
        <div className="min-w-0 flex-1">
          <WikiPageView page={page.data} />
        </div>
      </div>
    </AppShell>
  );
}
