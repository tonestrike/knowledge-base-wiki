import { useMutation, useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { isDriveAuthError } from '../../lib/drive-errors.ts';
import { orpc } from '../../lib/orpc.ts';
import { type PickAndCompilePhase, usePickAndCompile } from '../../lib/use-pick-and-compile.ts';
import { Button } from '../ui/button.tsx';

export interface DriveFolderPickerProps {
  /** Optional explicit return URL the api should send the user back to
   *  after OAuth completes. Defaults to the current origin's `/?drive=connected`. */
  returnTo?: string;
}

/**
 * Lists the signed-in user's Drive folders via `ingestion.listFolders` and
 * lets them pick one. Picking chains `registerFolder → startCompile → poll
 * compileRun → /wiki/<wikiId>` via {@link usePickAndCompile} so the user
 * lands on the live `CompileTheater` without an extra click.
 *
 * If the listFolders query fails with a Drive-auth-shaped error (typed
 * 401, OAuthTokenUnreadable, the connector's "No Drive tokens" message)
 * we render the in-line "Sign in to Drive" CTA instead. That doubles as
 * the entry point on a fresh browser session: the picker is what the user
 * sees first, regardless of whether they're signed in yet.
 */
export function DriveFolderPicker({ returnTo }: DriveFolderPickerProps) {
  const [query, setQuery] = useState('');
  const folders = useQuery({
    ...orpc.ingestion.listFolders.queryOptions({
      input: { limit: 50, ...(query.trim().length > 0 ? { query: query.trim() } : {}) },
    }),
    // Hide auth-error noise behind the sign-in CTA below; let other errors
    // surface to the user.
    retry: (count, err) => count < 1 && !isDriveAuthError(err),
  });

  const authStart = useMutation({
    ...orpc.ingestion.authStart.mutationOptions(),
    onSuccess: (data) => {
      window.location.assign(data.authorizationUrl);
    },
  });
  const triggerOauth = () => {
    const target =
      returnTo ?? `${window.location.origin}${window.location.pathname}?drive=connected`;
    authStart.mutate({ returnTo: target });
  };

  const { pick, phase, error: pickError } = usePickAndCompile();
  const needsAuth = folders.isError && isDriveAuthError(folders.error);

  if (needsAuth) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Sign in with Google so we can list folders from your Drive. We only request read access
          and never store the underlying files.
        </p>
        <Button variant="accent" onClick={triggerOauth} disabled={authStart.isPending}>
          {authStart.isPending ? 'Redirecting…' : 'Sign in to Drive'}
        </Button>
        {authStart.isError ? (
          <p className="text-xs text-destructive">{(authStart.error as Error).message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your Drive folders…"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors focus:outline-hidden focus:ring-2 focus:ring-accent"
      />
      {folders.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading folders…</p>
      ) : folders.isError ? (
        <p className="text-xs text-destructive">{(folders.error as Error).message}</p>
      ) : folders.data?.folders.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No folders found{query.trim().length > 0 ? ` matching "${query.trim()}"` : ''}.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-md border border-border/60 bg-card/40">
          {folders.data?.folders.map((f) => (
            <motion.li
              key={f.driveFolderId}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{f.name}</p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  modified {new Date(f.modifiedAt).toLocaleString()}
                </p>
              </div>
              <Button
                size="sm"
                variant="accent"
                onClick={() => pick({ driveFolderId: f.driveFolderId, name: f.name })}
                disabled={phase !== 'idle' && phase !== 'error'}
              >
                Compile →
              </Button>
            </motion.li>
          ))}
        </ul>
      )}
      <PhaseStatus phase={phase} error={pickError} />
    </div>
  );
}

function PhaseStatus({ phase, error }: { phase: PickAndCompilePhase; error: Error | null }) {
  if (phase === 'error' || error) {
    return (
      <p className="text-xs text-destructive">
        {error?.message ?? 'Something went wrong starting the compile.'}
      </p>
    );
  }
  if (phase === 'idle' || phase === 'done') return null;
  const label =
    phase === 'registering'
      ? 'Registering folder…'
      : phase === 'starting'
        ? 'Starting compile…'
        : 'Compiling… (typically takes 30-60s)';
  return <p className="text-xs text-accent">{label}</p>;
}
