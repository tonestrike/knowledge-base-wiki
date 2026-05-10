import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { orpc } from './orpc.ts';

/**
 * One-shot helper for the "Drive folder → wiki" hand-off. Chains four
 * effects that should feel like a single click to the user:
 *
 *   1. `ingestion.registerFolder` — persists the Folder row.
 *   2. `wiki.startCompile` — kicks off the async compile run.
 *   3. Poll `wiki.getCompileRun({ id })` until its `wikiId` is populated.
 *      `wikiId` is generated near the start of `compileFolder` but is only
 *      surfaced on the CompileRun once the wiki row is persisted, which
 *      happens after schema inference (a few seconds in). The previous
 *      flow navigated to `/wiki/<folderId>` immediately, but that URL
 *      param is treated as a `WikiId` and `getWiki(folderId)` returns
 *      not-found.
 *   4. `navigate('/wiki/<wikiId>', { state: { compileRunId } })` — lands
 *      the user on the right wiki id, with the run id stashed so
 *      `WikiRoute` can mount the `CompileTheater` immediately.
 *
 * The hook exposes a unified `phase` state (`idle | registering |
 * starting | awaiting-wiki-id | done | error`) so the picker can render a
 * single inline progress line instead of three independent spinners.
 */
export type PickAndCompilePhase =
  | 'idle'
  | 'registering'
  | 'starting'
  | 'awaiting-wiki-id'
  | 'done'
  | 'error';

interface ActiveRun {
  compileRunId: string;
  folderId: string;
}

export function usePickAndCompile() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [phase, setPhase] = useState<PickAndCompilePhase>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);

  const register = useMutation({ ...orpc.ingestion.registerFolder.mutationOptions() });
  const compile = useMutation({ ...orpc.wiki.startCompile.mutationOptions() });

  // Once `activeRun` is set we poll getCompileRun every second waiting for
  // its `wikiId` to appear. Default refetch is paused on tab blur,
  // which is the right behavior here (the user is staring at the picker).
  const runQuery = useQuery({
    ...orpc.wiki.getCompileRun.queryOptions({
      input: { id: activeRun?.compileRunId ?? '' },
    }),
    enabled: !!activeRun,
    refetchInterval: (q) => (q.state.data?.wikiId ? false : 1000),
  });

  useEffect(() => {
    if (!activeRun) return;
    const wikiId = runQuery.data?.wikiId;
    if (!wikiId) return;
    setPhase('done');
    // Pre-warm the wiki query so the destination route has data on first
    // paint instead of a brief loading flash.
    // Match every cached `listWikis` variant by passing the procedure's
    // top-level key (no input narrowing) — the picker may have read it
    // with a different `limit` than the home page.
    qc.invalidateQueries({ queryKey: orpc.wiki.listWikis.queryKey({ input: {} }) });
    nav(`/wiki/${wikiId}`, { state: { compileRunId: activeRun.compileRunId } });
  }, [activeRun, runQuery.data?.wikiId, nav, qc]);

  const pick = async (args: { driveFolderId: string; name: string }) => {
    setError(null);
    setActiveRun(null);
    setPhase('registering');
    try {
      const { folderId } = await register.mutateAsync(args);
      setPhase('starting');
      const { compileRunId } = await compile.mutateAsync({ folderId });
      setActiveRun({ compileRunId, folderId });
      setPhase('awaiting-wiki-id');
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setPhase('error');
    }
  };

  return {
    pick,
    phase,
    error:
      error ??
      (register.error as Error | null) ??
      (compile.error as Error | null) ??
      (runQuery.error as Error | null),
  };
}
