import type { Wiki } from '@package/contracts/wiki';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { DriveFolderPicker } from '../components/drive/drive-folder-picker.tsx';
import { FeaturedWikiHero } from '../components/featured-wiki-hero.tsx';
import { SignInCta } from '../components/sign-in-cta.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { driveFolderIdFrom, isDriveAuthError } from '../lib/drive-errors.ts';
import { orpc } from '../lib/orpc.ts';
import { usePickAndCompile } from '../lib/use-pick-and-compile.ts';

/**
 * The wiki we showcase at the top of the landing page. Hardcoded so an
 * incognito visitor sees a real, navigable example even before they sign
 * in — the value is the same in dev and prod since featured wikis live
 * in the shared D1.
 */
const FEATURED_WIKI_ID = 'cb0b020d-50ab-41cb-91d9-09a5dda547b2';

export function RootRoute() {
  const wikis = useQuery({
    ...orpc.wiki.listWikis.queryOptions({ input: { limit: 50 } }),
  });

  const featured = wikis.data?.items.find((w) => w.id === FEATURED_WIKI_ID);
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
            Your wikis
          </h1>
          <p className="max-w-prose text-base leading-relaxed text-muted-foreground">
            Compile any folder of documents into a typed wiki you can chat with — every claim
            anchored to the verbatim source bytes.
          </p>
        </motion.header>

        {featured ? <FeaturedWikiHero wiki={featured} /> : null}

        <CompiledWikisGrid
          wikis={otherWikis}
          isPending={wikis.isPending}
          error={wikis.isError ? (wikis.error as Error) : null}
          // When the featured hero is rendered the visitor already has
          // something to open, so we suppress the "no wikis yet" hint
          // and let the empty grid sit silently behind it.
          suppressEmptyHint={!!featured}
        />

        <ConnectDriveSection />
      </main>
    </AppShell>
  );
}

interface CompiledWikisGridProps {
  wikis: Wiki[];
  isPending: boolean;
  error: Error | null;
  suppressEmptyHint: boolean;
}

function CompiledWikisGrid({ wikis, isPending, error, suppressEmptyHint }: CompiledWikisGridProps) {
  return (
    <section className="space-y-4">
      <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
        Compiled wikis
      </h2>
      {renderGridBody({ wikis, isPending, error, suppressEmptyHint })}
    </section>
  );
}

function renderGridBody({ wikis, isPending, error, suppressEmptyHint }: CompiledWikisGridProps) {
  if (isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error)
    return <p className="text-sm text-destructive">Failed to load wikis: {error.message}</p>;
  if (wikis.length > 0) {
    return (
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
    );
  }
  if (suppressEmptyHint) return null;
  return (
    <p className="text-sm text-muted-foreground">
      No wikis yet — connect a Drive folder below to compile your first one.
    </p>
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

/**
 * Decides what entry point to show below the wiki grid:
 *  - If the user has no session (listFolders 401s with a Drive-auth-shaped
 *    error), render {@link SignInCta} so the first action is "sign in"
 *    rather than a broken folder picker.
 *  - Otherwise, render the full {@link DriveFolderPicker} card.
 *
 * We also clear the `?drive=connected` post-OAuth flag from the URL on
 * mount and invalidate `listFolders` so a stale 401 cached pre-OAuth
 * doesn't keep the CTA up after the user just signed in.
 */
function ConnectDriveSection() {
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

  // A lightweight probe of `listFolders` is the cheapest signal we have
  // for "is there a Drive session?" — the same query the picker uses
  // internally, so the answer is shared across both branches of the UI.
  const folders = useQuery({
    ...orpc.ingestion.listFolders.queryOptions({ input: { limit: 1 } }),
    retry: (count, err) => count < 1 && !isDriveAuthError(err),
  });
  const needsAuth = folders.isError && isDriveAuthError(folders.error);

  if (needsAuth) {
    return <SignInCta />;
  }

  return <ConnectDriveCard />;
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
