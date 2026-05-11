import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { WikiPageView } from '../components/wiki-page/wiki-page.tsx';
import { WikiTreeSidebar } from '../components/wiki/wiki-tree-sidebar.tsx';
import { orpc } from '../lib/orpc.ts';

export function WikiPageRoute() {
  const { wikiId = '', pageId = '' } = useParams();
  // `placeholderData: keepPreviousData` is the fix for the "jumpy
  // skeleton between pages" the user noticed. Without it, navigating
  // from one wiki page to another unmounts the current page's content,
  // flashes the `LoadingState` skeleton for ~200ms, then renders the
  // new page. With it, the previous page stays visible while the new
  // fetch is in flight — the skeleton only ever shows on the very
  // first visit. `isPlaceholderData` lets us still fade between the
  // two so the swap is felt rather than appearing instantaneous.
  const page = useQuery({
    ...orpc.wiki.getPage.queryOptions({ input: { id: pageId } }),
    enabled: !!pageId,
    placeholderData: keepPreviousData,
  });

  const showFirstLoadSkeleton = page.isPending;

  if (showFirstLoadSkeleton) {
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
  if ((page.isError && !page.data) || (!page.isFetching && !page.data)) {
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
  // `page.data` is non-null here. While react-query is fetching the
  // new page (isFetching && isPlaceholderData), we render the OLD
  // page at slightly reduced opacity so the user sees a hand-off
  // instead of a content swap.
  const isSwapping = page.isFetching && page.isPlaceholderData;
  if (!page.data) return null;
  return (
    <AppShell trail={[{ label: page.data.title }]}>
      <div className="flex">
        <WikiTreeSidebar wikiId={wikiId} />
        <div className="min-w-0 flex-1">
          <motion.div
            key={page.data.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: isSwapping ? 0.5 : 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <WikiPageView page={page.data} />
          </motion.div>
        </div>
      </div>
    </AppShell>
  );
}
