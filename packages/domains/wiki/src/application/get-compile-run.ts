import type { CompileRunId } from '@package/contracts/shared';
import type { CompileRun as CompileRunWire } from '@package/contracts/wiki';
import type { WikiDeps } from './ports.ts';

export async function getCompileRun(
  deps: Pick<WikiDeps, 'runs'>,
  input: { id: CompileRunId },
): Promise<CompileRunWire> {
  const r = await deps.runs.findById(input.id);
  if (!r) throw new Error(`CompileRun not found: ${input.id}`);
  return {
    id: r.id,
    folderId: r.folderId,
    wikiId: r.wikiId,
    // The wire status union excludes 'failed' is NOT true — it includes it
    // (see compile contract). Cast through to satisfy zod parsers downstream.
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    schemaInferredAt: r.schemaInferredAt,
  };
}
