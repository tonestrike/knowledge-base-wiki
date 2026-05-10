import type { CompileRunId } from '@package/contracts/shared';
import type { CompileRun as CompileRunWire } from '@package/contracts/wiki';
import type { CompileRun } from '../domain/compile-run.ts';
import type { WikiDeps } from './ports.ts';

// Project a status-discriminated CompileRun onto its flat wire shape.
const toWire = (r: CompileRun): CompileRunWire => {
  const base = {
    id: r.id,
    folderId: r.folderId,
    status: r.status,
    startedAt: r.startedAt,
  } as const;
  switch (r.status) {
    case 'pending':
    case 'inferring-schema':
      return base;
    case 'planning':
    case 'researching':
    case 'drafting':
    case 'linking':
    case 'indexing':
      return { ...base, schemaInferredAt: r.schemaInferredAt };
    case 'finished':
      return {
        ...base,
        wikiId: r.wikiId,
        endedAt: r.endedAt,
        schemaInferredAt: r.schemaInferredAt,
      };
    case 'failed':
      return {
        ...base,
        endedAt: r.endedAt,
        schemaInferredAt: r.schemaInferredAt,
      };
  }
};

export async function getCompileRun(
  deps: Pick<WikiDeps, 'runs'>,
  input: { id: CompileRunId },
): Promise<CompileRunWire> {
  const r = await deps.runs.findById(input.id);
  if (!r) throw new Error(`CompileRun not found: ${input.id}`);
  return toWire(r);
}
