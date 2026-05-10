import type { Wiki } from '@package/contracts/wiki';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppShell } from '../components/app-shell.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { orpc } from '../lib/orpc.ts';

const driveFolderIdFrom = (input: string): string => {
  const trimmed = input.trim();
  const m = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? trimmed;
};

// SF8 — Drive auth-failure heuristic. The oRPC server emits a typed error
// code which surfaces in the message; we match common shapes so a future
// server-side rename doesn't silently stop us from showing the Re-connect
// button.
const isDriveAuthError = (e: unknown): boolean => {
  const msg = (e as Error | undefined)?.message ?? '';
  return /NOT_AUTHENTICATED|missing Drive token|drive_unauthorized|401/i.test(msg);
};

const triggerDriveOauth = () => {
  // Re-routes through the API which serves the OAuth start flow. The API
  // sets the cookie and 302s back to '/'.
  window.location.assign('/api/auth/drive');
};

export function RootRoute() {
  const wikis = useQuery({
    ...orpc.wiki.listWikis.queryOptions({ input: { limit: 50 } }),
  });

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl space-y-12 px-6 py-12">
        <header>
          <h1 className="font-serif text-5xl tracking-tight">Your wikis</h1>
          <p className="mt-3 max-w-prose text-muted-foreground">
            Compile a Drive folder into a typed wiki you can chat with — and verify against the
            original sources.
          </p>
        </header>

        <section>
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Compiled wikis
          </h2>
          {wikis.isPending ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          ) : wikis.isError ? (
            <p className="mt-4 text-sm text-destructive">
              Failed to load wikis: {(wikis.error as Error).message}
            </p>
          ) : wikis.data && wikis.data.items.length > 0 ? (
            <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {wikis.data.items.map((w) => (
                <li key={w.id}>
                  <WikiCard wiki={w} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
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
    <Link
      to={`/wiki/${wiki.id}`}
      className="block h-full rounded-lg border border-border bg-card/40 p-5 transition-colors hover:border-accent/50 hover:bg-card"
    >
      <p className="font-serif text-xl tracking-tight">{folderName}</p>
      <p className="mt-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {wiki.pageCount} {wiki.pageCount === 1 ? 'page' : 'pages'}
        {lastCompiled ? ` · compiled ${lastCompiled}` : ''}
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
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
  );
}

function ConnectDriveCard() {
  const nav = useNavigate();
  const [url, setUrl] = useState('');
  const register = useMutation({
    ...orpc.ingestion.registerFolder.mutationOptions(),
    onSuccess: (data) => nav(`/wiki/${data.folderId}`),
  });
  const authFailure = register.isError && isDriveAuthError(register.error);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a Drive folder</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Paste a Google Drive folder URL or ID to register it for compile. You'll be prompted to
          sign in to Google Drive on first use.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const id = driveFolderIdFrom(url);
            if (id) register.mutate({ driveFolderId: id, name: 'Demo' });
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/..."
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button variant="accent" type="submit" disabled={register.isPending}>
            {register.isPending ? 'Connecting…' : 'Connect'}
          </Button>
          <Button type="button" variant="outline" onClick={triggerDriveOauth}>
            Sign in to Drive
          </Button>
        </form>
        {/* SF8 — auth failure used to render a raw "NOT_AUTHENTICATED:
            missing Drive token" string. Now we recognize the code and offer a
            Re-connect button that triggers the OAuth flow. */}
        {authFailure ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-verdict-contradicted/40 bg-verdict-contradicted/5 px-3 py-2">
            <p className="text-xs">Drive isn&apos;t connected yet. Reconnect to continue.</p>
            <Button variant="outline" size="sm" onClick={triggerDriveOauth}>
              Re-connect Drive
            </Button>
          </div>
        ) : register.isError ? (
          <p className="text-xs text-verdict-contradicted">
            {String((register.error as Error).message)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
