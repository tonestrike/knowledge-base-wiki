import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
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
      <AppShell>
        <main className="mx-auto max-w-6xl px-6 py-12">
          <LoadingState rows={6} />
        </main>
      </AppShell>
    );
  }
  if (page.isError || !page.data) {
    return (
      <AppShell>
        <main className="mx-auto max-w-6xl px-6 py-12">
          <ErrorState
            message={(page.error as Error | null)?.message ?? 'Failed to load page.'}
            onRetry={() => page.refetch()}
          />
        </main>
      </AppShell>
    );
  }
  return (
    <AppShell trail={[{ label: page.data.title }]}>
      <WikiPageView page={page.data} />
    </AppShell>
  );
}
