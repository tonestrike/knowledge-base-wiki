import type { Source as SourceWire } from '@package/contracts/ingestion';
import type { SourceId } from '@package/contracts/shared';
import type { IngestionDeps } from './ports.ts';

export class SourceNotFoundError extends Error {
  constructor(id: SourceId) {
    super(`Source not found: ${id}`);
    this.name = 'SourceNotFoundError';
  }
}

export async function getSource(deps: IngestionDeps, input: { id: SourceId }): Promise<SourceWire> {
  const s = await deps.sources.findById(input.id);
  if (!s) throw new SourceNotFoundError(input.id);
  return deps.sources.toWire(s);
}
