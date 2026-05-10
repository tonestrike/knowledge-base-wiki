import type { Wiki } from '@package/contracts/wiki';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { DriveFolderPicker } from '../components/drive/drive-folder-picker.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { driveFolderIdFrom } from '../lib/drive-errors.ts';
import { orpc } from '../lib/orpc.ts';
import { usePickAndCompile } from '../lib/use-pick-and-compile.ts';

export function RootRoute() {
  const wikis = useQuery({
    ...orpc.wiki.listWikis.queryOptions({ input: { limit: 50 } }),
  });

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

        <section className="space-y-4">
          <h2 className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            Compiled wikis
          </h2>
          {wikis.isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : wikis.isError ? (
            <p className="text-sm text-destructive">
              Failed to load wikis: {(wikis.error as Error).message}
            </p>
          ) : wikis.data && wikis.data.items.length > 0 ? (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {wikis.data.items.map((w, i) => (
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

        <ConnectDriveCard />
      </main>
    </AppShell>
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
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  // Detect the post-OAuth landing flag and clear it from the URL on mount
  // so a refresh doesn't keep replaying the "just signed in" effects. We
  // also force the picker's `listFolders` query to refetch — its previous
  // result was likely an auth error fetched seconds ago, and the cached
  // 401 would otherwise mask the now-good token.
  const justConnected = params.get('drive') === 'connected';
  useEffect(() => {
    if (!justConnected) return;
    const next = new URLSearchParams(params);
    next.delete('drive');
    setParams(next, { replace: true });
    qc.invalidateQueries({ queryKey: orpc.ingestion.listFolders.queryKey({ input: {} }) });
  }, [justConnected, params, setParams, qc]);

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
