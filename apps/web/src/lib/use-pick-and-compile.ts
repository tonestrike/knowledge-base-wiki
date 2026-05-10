import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { orpc } from './orpc.ts';

/**
 * "Drive folder → wiki" hand-off, kept deliberately thin.
 *
 *   1. `ingestion.registerFolder` — persists the Folder row.
 *   2. `navigate('/folder/<folderId>/ingest')` — hands off to the
 *      well-animated ingest page, which calls `ingestFolder` on mount
 *      (with live per-file progress) and then chains into
 *      `startCompile` + nav to `/compile/<runId>`.
 *
 * Doing register here and ingest/compile on dedicated pages means each
 * stage has its own theater — the user sees something engaging the
 * moment they click instead of staring at a silent picker while the
 * 30-60s ingest happens.
 */
export type PickAndCompilePhase = 'idle' | 'registering' | 'done' | 'error';

export function usePickAndCompile() {
  const nav = useNavigate();
  const [phase, setPhase] = useState<PickAndCompilePhase>('idle');
  const [error, setError] = useState<Error | null>(null);

  const register = useMutation({ ...orpc.ingestion.registerFolder.mutationOptions() });

  const pick = async (args: { driveFolderId: string; name: string }) => {
    setError(null);
    setPhase('registering');
    try {
      const { folderId } = await register.mutateAsync(args);
      setPhase('done');
      nav(`/folder/${folderId}/ingest`);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setPhase('error');
    }
  };

  return {
    pick,
    phase,
    error: error ?? (register.error as Error | null),
  };
}
