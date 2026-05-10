import type { WikiPage } from '@package/contracts/wiki';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Sidebar } from './sidebar.tsx';

export interface WikiPageViewProps {
  page: WikiPage;
}

export function WikiPageView({ page }: WikiPageViewProps) {
  return (
    <article className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-6 py-12 md:grid-cols-[minmax(0,60ch)_280px]">
      <div>
        {page.pageType ? (
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">
            {page.pageType}
          </p>
        ) : null}
        <h1 className="mt-2 font-serif text-4xl leading-tight tracking-tight md:text-5xl">
          {page.title}
        </h1>
        <div className="prose-magazine mt-8 [&>h2]:mt-10 [&>h2]:font-serif [&>h2]:text-2xl [&>h2]:tracking-tight [&>p]:mt-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.body}</ReactMarkdown>
        </div>
      </div>
      <Sidebar page={page} />
    </article>
  );
}
