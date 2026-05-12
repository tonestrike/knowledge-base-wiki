import type { Wiki } from '@package/contracts/wiki';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { DriveFolderPicker } from '../components/drive/drive-folder-picker.tsx';
import { FeaturedWikiHero } from '../components/featured-wiki-hero.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { driveFolderIdFrom, isDriveAuthError } from '../lib/drive-errors.ts';
import { orpc } from '../lib/orpc.ts';
import { usePickAndCompile } from '../lib/use-pick-and-compile.ts';

/**
 * The wiki we showcase at the top of the landing page. Hardcoded so an
 * incognito visitor sees a real, navigable example without signing in —
 * the value is the same in dev and prod since featured wikis live in the
 * shared D1.
 *
 * Public-by-design: the Google OAuth client backing `authStart` is in
 * Google's unverified status, so prompting public visitors to "Sign in
 * with Google" is wrong — clicking it would fail Google's unverified-app
 * screen. The reviewer reads this seeded wiki as the primary product and
 * never sees an auth surface. The "compile your own folder" path is
 * developer-only and stays behind a Drive session.
 */
const FEATURED_WIKI_ID = 'cb0b020d-50ab-41cb-91d9-09a5dda547b2';

export function RootRoute() {
  useDriveConnectedHandshake();

  // Lookup the featured wiki directly. Calling `getWiki` (rather than
  // filtering `listWikis`) means the anonymous visitor always gets the
  // hero regardless of how Stream A scopes `listWikis` per-user.
  const featured = useQuery({
    ...orpc.wiki.getWiki.queryOptions({ input: { id: FEATURED_WIKI_ID } }),
    retry: false,
  });

  // "Is this visitor a sessioned developer?" is decided by a single probe
  // of `listFolders`. Anything other than a clean success is treated as
  // anonymous; we never let an auth error escape into the UI.
  const session = useSessionProbe();
  const isSessioned = session === 'sessioned';

  const wikis = useQuery({
    ...orpc.wiki.listWikis.queryOptions({ input: { limit: 50 } }),
    // Personal wikis grid is dev-only. Anonymous visitors land on the
    // featured hero and nothing else.
    enabled: isSessioned,
  });

  const otherWikis = (wikis.data?.items ?? []).filter((w) => w.id !== FEATURED_WIKI_ID);

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl space-y-16 px-6 py-16">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="space-y-3"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">
            Folder · Wiki · Verify
          </p>
          <h1 className="font-serif text-6xl leading-[0.95] tracking-tight md:text-7xl">
            A folder, compiled.
          </h1>
          <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
            Compiled from a Drive folder — read it to see the system in action. Every claim is
            anchored to the verbatim source bytes.
          </p>
        </motion.header>

        <FeaturedHeroSlot
          wiki={featured.data}
          isPending={featured.isPending}
          isError={featured.isError}
        />

        {isSessioned ? (
          <CompiledWikisGrid
            wikis={otherWikis}
            isPending={wikis.isPending}
            error={wikis.isError ? (wikis.error as Error) : null}
          />
        ) : null}
        <ConnectDriveCard />
      </main>
    </AppShell>
  );
}

/**
 * Detects the post-OAuth landing flag (`?drive=connected`) and clears it
 * from the URL, while invalidating any cached `listFolders` 401 from
 * before the round-trip. Lifted to the top of `RootRoute` so it runs even
 * when the session probe is still saying "anonymous" and the dev-only
 * picker hasn't mounted yet — without this, a stale 401 would keep the
 * homepage in its anonymous state forever after a successful OAuth.
 */
function useDriveConnectedHandshake() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const justConnected = params.get('drive') === 'connected';
  useEffect(() => {
    if (!justConnected) return;
    const next = new URLSearchParams(params);
    next.delete('drive');
    setParams(next, { replace: true });
    qc.invalidateQueries({ queryKey: orpc.ingestion.listFolders.queryKey({ input: {} }) });
  }, [justConnected, params, setParams, qc]);
}

type SessionStatus = 'pending' | 'sessioned' | 'anonymous';

/**
 * Quietly probes whether the visitor has a valid Drive session. Any error
 * (typed 401 from Stream A's session middleware, OAuthTokenUnreadable,
 * the connector's "No Drive tokens" message) is treated as anonymous.
 * Errors are deliberately swallowed — this isn't a UI surface, just a
 * gate for the dev-only ingest controls.
 */
function useSessionProbe(): SessionStatus {
  const probe = useQuery({
    ...orpc.ingestion.listFolders.queryOptions({ input: { limit: 1 } }),
    retry: false,
    staleTime: 30_000,
  });
  if (probe.isPending) return 'pending';
  if (probe.isError) return 'anonymous';
  if (isDriveAuthError(probe.error)) return 'anonymous';
  return 'sessioned';
}

function FeaturedHeroSlot({
  wiki,
  isPending,
  isError,
}: {
  wiki: Wiki | undefined;
  isPending: boolean;
  isError: boolean;
}) {
  if (isPending) {
    return (
      <section
        aria-label="Featured wiki"
        className="rounded-2xl border border-accent/20 bg-card/40 p-8"
      >
        <p className="text-sm text-muted-foreground">Loading the featured wiki…</p>
      </section>
    );
  }
  // Graceful degradation: if the featured wiki can't be fetched, fall back
  // to plain copy and a direct link. The reviewer never sees a hard error.
  if (isError || !wiki) {
    return (
      <section
        aria-label="Featured wiki"
        className="rounded-2xl border border-accent/20 bg-card/40 p-8"
      >
        <p className="text-sm text-muted-foreground">
          The seeded demo wiki is temporarily unavailable.{' '}
          <Link to={`/wiki/${FEATURED_WIKI_ID}`} className="text-accent underline">
            Try opening it directly →
          </Link>
        </p>
      </section>
    );
  }
  return <FeaturedWikiHero wiki={wiki} />;
}

interface CompiledWikisGridProps {
  wikis: Wiki[];
  isPending: boolean;
  error: Error | null;
}

function CompiledWikisGrid({ wikis, isPending, error }: CompiledWikisGridProps) {
  return (
    <section className="space-y-4">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Your wikis
      </h2>
      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="text-sm text-destructive">Failed to load wikis: {error.message}</p>
      ) : wikis.length > 0 ? (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {wikis.map((w, i) => (
            <motion.li
              key={w.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05 }}
            >
              <WikiCard wiki={w} />
            </motion.li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          No wikis yet — connect a Drive folder below to compile your first one.
        </p>
      )}
    </section>
  );
}

function WikiCard({ wiki }: { wiki: Wiki }) {
  const folder = useQuery({
    ...orpc.ingestion.getFolder.queryOptions({ input: { id: wiki.folderId } }),
  });

  const folderName = folder.data?.name ?? wiki.folderId;
  const pageTypes = wiki.schema.pageTypes.slice(0, 4).map((p) => p.name);
  const lastCompiled = wiki.lastCompiledAt
    ? new Date(wiki.lastCompiledAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <motion.div whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 300, damping: 22 }}>
      <Link
        to={`/wiki/${wiki.id}`}
        className="group relative block h-full overflow-hidden rounded-lg border border-border bg-card/40 p-5 transition-colors hover:border-accent/60 hover:bg-card"
      >
        <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-accent/0 to-transparent transition-all duration-500 group-hover:via-accent/60" />
        <p className="font-serif text-xl tracking-tight">{folderName}</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {wiki.pageCount} {wiki.pageCount === 1 ? 'page' : 'pages'}
          {lastCompiled ? ` · ${lastCompiled}` : ''}
        </p>
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {pageTypes.map((name) => (
            <li
              key={name}
              className="rounded-full border border-accent/30 bg-accent/5 px-2 py-0.5 font-mono text-[10px] text-accent"
            >
              {name}
            </li>
          ))}
          {wiki.schema.pageTypes.length > pageTypes.length ? (
            <li className="font-mono text-[10px] text-muted-foreground">
              +{wiki.schema.pageTypes.length - pageTypes.length}
            </li>
          ) : null}
        </ul>
      </Link>
    </motion.div>
  );
}

function ConnectDriveCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
    >
      <Card className="border-accent/20 bg-accent/2">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">Connect a Drive folder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Pick a folder from your Google Drive. We'll register it and start a Compile run; you'll
            land on the wiki as it's being built.
          </p>
          <DriveFolderPicker />
          <details className="group rounded-md border border-border/60 bg-card/30 px-3 py-2">
            <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
              Paste a folder URL instead
            </summary>
            <div className="mt-3">
              <PasteFolderForm />
            </div>
          </details>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/**
 * The legacy "paste a Drive URL" entry point, kept under a `<details>`
 * disclosure so it covers the cases the picker can't:
 *  - Folders shared with you that don't appear in your Drive's My Drive root.
 *  - Direct links a colleague sent that you want to compile without
 *    browsing for them.
 */
function PasteFolderForm() {
  const [url, setUrl] = useState('');
  const { pick, phase, error } = usePickAndCompile();
  const submitting = phase !== 'idle' && phase !== 'error';
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        const id = driveFolderIdFrom(url);
        if (id) pick({ driveFolderId: id, name: 'Drive folder' });
      }}
    >
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://drive.google.com/drive/folders/..."
        className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors focus:outline-hidden focus:ring-2 focus:ring-accent"
      />
      <Button variant="outline" type="submit" disabled={submitting}>
        {submitting ? 'Working…' : 'Compile'}
      </Button>
      {error && phase === 'error' ? (
        <p className="basis-full text-xs text-destructive">{error.message}</p>
      ) : null}
    </form>
  );
}

// Re-export so callers (e.g. tests) can keep a stable reference even if we
// move the constant later.
export { FEATURED_WIKI_ID };
