import type { WikiPage } from '@package/contracts/wiki';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sidebar } from './sidebar.tsx';

export interface WikiPageViewProps {
  page: WikiPage;
}

export function WikiPageView({ page }: WikiPageViewProps) {
  return (
    <article className="mx-auto grid max-w-6xl grid-cols-[minmax(0,60ch)_280px] gap-12 px-6 py-12">
      <div>
        {page.pageType ? (
          <p className="font-mono text-xs uppercase tracking-widest text-accent">{page.pageType}</p>
        ) : null}
        <h1 className="mt-2 font-serif text-4xl tracking-tight">{page.title}</h1>
        <div className="prose-magazine mt-8 [&>h2]:mt-8 [&>h2]:font-serif [&>h2]:text-2xl">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.body}</ReactMarkdown>
        </div>
      </div>
      <Sidebar page={page} />
    </article>
  );
}
