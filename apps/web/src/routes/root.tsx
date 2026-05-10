import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ThemeToggle } from '../components/theme-toggle.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.tsx';
import { orpc } from '../lib/orpc.ts';

const driveFolderIdFrom = (input: string): string => {
  const trimmed = input.trim();
  const m = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? trimmed;
};

const DEMO_WIKI_ID = '44444444-2222-4333-8444-555555555555';

// Heuristic to detect Drive auth failure from the error payload. The
// oRPC server emits a typed error code which surfaces in the message;
// we match common shapes so a future server-side rename doesn't silently
// stop us from showing the Re-connect button (SF8).
const isDriveAuthError = (e: unknown): boolean => {
  const msg = (e as Error | undefined)?.message ?? '';
  return /NOT_AUTHENTICATED|missing Drive token|drive_unauthorized|401/i.test(msg);
};

const triggerDriveOauth = () => {
  // Re-routes through the API which serves the OAuth start flow. The API
  // sets the cookie and 302s back to '/'. If the route doesn't exist yet
  // (mock/MSW), the browser will navigate to /api/auth/drive and 404 —
  // which is still strictly better UX than a raw error string, because
  // the user understands an auth action is required.
  window.location.assign('/api/auth/drive');
};

export function RootRoute() {
  const nav = useNavigate();
  const [url, setUrl] = useState('');
  const register = useMutation({
    ...orpc.ingestion.registerFolder.mutationOptions(),
    onSuccess: (data) => nav(`/wiki/${data.folderId}`),
  });

  const authFailure = register.isError && isDriveAuthError(register.error);

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-5xl tracking-tight">folder-wiki</h1>
          <p className="mt-3 max-w-prose text-muted-foreground">
            Compile a Drive folder into a typed wiki you can chat with — and verify.
          </p>
        </div>
        <ThemeToggle />
      </header>
      <Card className="mt-10">
        <CardHeader>
          <CardTitle>Connect a Drive folder</CardTitle>
        </CardHeader>
        <CardContent>
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
          </form>
          {/* SF8 — auth failure used to render a raw "NOT_AUTHENTICATED:
              missing Drive token" string. Now we recognize the code and
              offer a Re-connect button that triggers the OAuth flow. */}
          {authFailure ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-verdict-contradicted/40 bg-verdict-contradicted/5 px-3 py-2">
              <p className="text-xs">Drive isn&apos;t connected yet. Reconnect to continue.</p>
              <Button variant="outline" size="sm" onClick={triggerDriveOauth}>
                Re-connect Drive
              </Button>
            </div>
          ) : register.isError ? (
            <p className="mt-2 text-xs text-verdict-contradicted">
              {String((register.error as Error).message)}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <p className="mt-12 text-sm text-muted-foreground">
        <Link
          to={`/wiki/${DEMO_WIKI_ID}`}
          className="underline-offset-4 hover:text-accent hover:underline"
        >
          Or jump straight to the demo wiki →
        </Link>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        <Link to="/design-system" className="underline-offset-4 hover:underline">
          Design system
        </Link>
      </p>
    </main>
  );
}
