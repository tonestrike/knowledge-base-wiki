import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { WikiPageView } from '../components/wiki-page/wiki-page.tsx';
import { orpc } from '../lib/orpc.ts';

export function WikiPageRoute() {
  const { pageId = '' } = useParams();
  const page = useQuery({
    ...orpc.wiki.getPage.queryOptions({ input: { id: pageId } }),
    enabled: !!pageId,
  });

  if (page.isPending) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <LoadingState rows={6} />
      </main>
    );
  }
  if (page.isError || !page.data) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <ErrorState
          message={(page.error as Error | null)?.message ?? 'Failed to load page.'}
          onRetry={() => page.refetch()}
        />
      </main>
    );
  }
  return <WikiPageView page={page.data} />;
}
