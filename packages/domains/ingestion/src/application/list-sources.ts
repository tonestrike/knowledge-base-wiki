import type { ListSourcesOutput } from '@package/contracts/ingestion';
import type { FolderId } from '@package/contracts/shared';
import type { IngestionDeps } from './ports.ts';

export interface ListSourcesInput {
  readonly folderId: FolderId;
  readonly cursor?: string;
  readonly limit: number;
}

export async function listSources(
  deps: IngestionDeps,
  input: ListSourcesInput,
): Promise<ListSourcesOutput> {
  const out = await deps.sources.list(input);
  return {
    items: out.items.map((s) => deps.sources.toWire(s)),
    nextCursor: out.nextCursor,
  };
}
