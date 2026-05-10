import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { orpc } from '../lib/orpc.ts';
import { useChatDock } from './chat-dock/chat-dock-context.tsx';
import { ThemeToggle } from './theme-toggle.tsx';

interface AppShellProps {
  children: ReactNode;
  /** Optional breadcrumb trail (last item is the current page). */
  trail?: Array<{ label: string; to?: string }>;
  /**
   * Override the wikiId used for the breadcrumb + tab links. Routes whose URL
   * doesn't carry `:wikiId` (chat) pass this once they know it from the
   * conversation.
   */
  wikiId?: string;
}

/**
 * Top-level chrome for every wiki/lint/chat/page route.
 *
 * Layout:
 *   [tenex]   <folder name> > <breadcrumb>          [Overview] [Lint] [Chat]   [☼]
 */
export function AppShell({ children, trail, wikiId: wikiIdOverride }: AppShellProps) {
  const params = useParams();
  const location = useLocation();
  const wikiId = wikiIdOverride ?? (params.wikiId as string | undefined) ?? '';
  const dock = useChatDock();

  const wiki = useQuery({
    ...orpc.wiki.getWiki.queryOptions({ input: { id: wikiId } }),
    enabled: !!wikiId,
  });
  const folder = useQuery({
    ...orpc.ingestion.getFolder.queryOptions({ input: { id: wiki.data?.folderId ?? '' } }),
    enabled: !!wiki.data?.folderId,
  });

  const folderName = folder.data?.name ?? wiki.data?.folderId ?? '';
  const isLint = location.pathname.endsWith('/lint');
  const isPage = /\/page\//.test(location.pathname);
  const isOverview = !!wikiId && !isLint && !isPage;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <Link
            to="/"
            className="font-serif text-lg tracking-tight hover:text-foreground/70"
            aria-label="Tenex home"
          >
            tenex
          </Link>

          {wikiId && (
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-sm">
              <span className="text-muted-foreground">/</span>
              <Link
                to={`/wiki/${wikiId}`}
                className="truncate font-medium hover:underline"
                title={folderName}
              >
                {folderName}
              </Link>
              {trail?.map((t) => (
                <span key={t.label} className="flex min-w-0 items-center gap-2">
                  <span className="text-muted-foreground">/</span>
                  {t.to ? (
                    <Link to={t.to} className="truncate hover:underline">
                      {t.label}
                    </Link>
                  ) : (
                    <span className="truncate text-muted-foreground">{t.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-1">
            {wikiId && (
              <nav aria-label="Wiki sections" className="flex items-center gap-1">
                <TabLink to={`/wiki/${wikiId}`} active={isOverview}>
                  Overview
                </TabLink>
                <TabLink to={`/wiki/${wikiId}/lint`} active={isLint}>
                  Lint
                </TabLink>
                <button
                  type="button"
                  onClick={() => dock.openFor(wikiId)}
                  className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors ${
                    dock.open
                      ? 'bg-foreground/10 font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
                  }`}
                  aria-pressed={dock.open}
                >
                  Chat
                  <kbd className="hidden rounded border border-border/60 bg-card/40 px-1 font-mono text-[10px] text-muted-foreground sm:inline">
                    ⌘K
                  </kbd>
                </button>
              </nav>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}

function TabLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`rounded px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-foreground/10 font-medium text-foreground'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
      }`}
    >
      {children}
    </Link>
  );
}
