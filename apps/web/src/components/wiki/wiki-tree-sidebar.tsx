import { useQuery } from '@tanstack/react-query';
import { BookOpenIcon, FileTextIcon, ListTreeIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { orpc } from '../../lib/orpc.ts';

export interface WikiTreeSidebarProps {
  wikiId: string;
}

/**
 * Left-rail navigation for a wiki: pages grouped by PageType (using the
 * compiled schema's ordering), with the IndexPage surfaced first as a
 * "table of contents" entry and ConceptPages indented underneath it.
 *
 * Sticky under the AppShell header so it stays visible on scroll. The
 * active page (matched against `useLocation().pathname`) gets an accent
 * left-border + bold treatment.
 *
 * Hidden below the `lg` breakpoint to avoid eating mobile width — the
 * single-page route still shows its own title above the body, so users
 * keep their bearings without the tree.
 */
export function WikiTreeSidebar({ wikiId }: WikiTreeSidebarProps) {
  const location = useLocation();
  const wiki = useQuery({
    ...orpc.wiki.getWiki.queryOptions({ input: { id: wikiId } }),
    enabled: !!wikiId,
  });
  const pages = useQuery({
    ...orpc.wiki.listPages.queryOptions({ input: { wikiId, limit: 100 } }),
    enabled: !!wikiId,
  });

  const pageTypes = wiki.data?.schema.pageTypes ?? [];
  const items = pages.data?.items ?? [];

  // Catch any pages whose pageType isn't in the schema (e.g. Answer
  // subtype, or schema drift) so they still appear in the tree.
  const knownTypeNames = new Set(pageTypes.map((pt) => pt.name));
  const orphanedPages = items.filter((p) => !p.pageType || !knownTypeNames.has(p.pageType));

  return (
    <aside
      aria-label="Wiki pages"
      className="hidden w-72 shrink-0 border-r border-border/60 bg-background/40 lg:block"
    >
      <div className="sticky top-0 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-4 py-6">
        <p className="px-2 pb-3 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          Pages
        </p>
        {pageTypes.length === 0 ? (
          <p className="px-2 text-xs text-muted-foreground">No pages yet.</p>
        ) : null}
        <nav className="space-y-5">
          {pageTypes.map((pt) => {
            const ofType = items.filter((p) => p.pageType === pt.name);
            const indexPage = ofType.find((p) => p.subtype === 'Index');
            const conceptPages = ofType.filter((p) => p.subtype === 'Concept');
            const otherPages = ofType.filter(
              (p) => p.subtype !== 'Index' && p.subtype !== 'Concept',
            );
            return (
              <section key={pt.name}>
                <p className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
                  {pt.name}
                </p>
                <ul className="space-y-0.5">
                  {indexPage ? (
                    <TreeRow
                      key={indexPage.id}
                      to={`/wiki/${wikiId}/page/${indexPage.id}`}
                      active={location.pathname.endsWith(`/page/${indexPage.id}`)}
                      icon={<ListTreeIcon className="h-3.5 w-3.5" />}
                      label={indexPage.title}
                    />
                  ) : null}
                  {conceptPages.map((p) => (
                    <TreeRow
                      key={p.id}
                      to={`/wiki/${wikiId}/page/${p.id}`}
                      active={location.pathname.endsWith(`/page/${p.id}`)}
                      icon={<FileTextIcon className="h-3.5 w-3.5" />}
                      label={p.title}
                      indent
                    />
                  ))}
                  {otherPages.map((p) => (
                    <TreeRow
                      key={p.id}
                      to={`/wiki/${wikiId}/page/${p.id}`}
                      active={location.pathname.endsWith(`/page/${p.id}`)}
                      icon={<BookOpenIcon className="h-3.5 w-3.5" />}
                      label={p.title}
                      indent
                    />
                  ))}
                  {ofType.length === 0 ? (
                    <li className="px-2 py-1 text-[11px] text-muted-foreground/60 italic">
                      no pages
                    </li>
                  ) : null}
                </ul>
              </section>
            );
          })}
          {orphanedPages.length > 0 ? (
            <section>
              <p className="px-2 pb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Other
              </p>
              <ul className="space-y-0.5">
                {orphanedPages.map((p) => (
                  <TreeRow
                    key={p.id}
                    to={`/wiki/${wikiId}/page/${p.id}`}
                    active={location.pathname.endsWith(`/page/${p.id}`)}
                    icon={<BookOpenIcon className="h-3.5 w-3.5" />}
                    label={p.title}
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </nav>
      </div>
    </aside>
  );
}

interface TreeRowProps {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  indent?: boolean;
}

function TreeRow({ to, active, icon, label, indent }: TreeRowProps) {
  return (
    <li>
      <Link
        to={to}
        aria-current={active ? 'page' : undefined}
        className={`group flex items-center gap-2 rounded-sm border-l-2 py-1 pr-2 text-sm transition-colors ${
          indent ? 'pl-6' : 'pl-2'
        } ${
          active
            ? 'border-accent bg-accent/10 font-medium text-foreground'
            : 'border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
        }`}
      >
        <span
          className={`shrink-0 ${active ? 'text-accent' : 'text-muted-foreground/70 group-hover:text-foreground/80'}`}
        >
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </Link>
    </li>
  );
}
