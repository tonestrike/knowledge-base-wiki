import type { WikiId, WikiSchema } from '@package/contracts/shared';
import type { WikiDeps } from './ports.ts';

export async function getSchema(
  deps: Pick<WikiDeps, 'wikis'>,
  input: { id: WikiId },
): Promise<WikiSchema> {
  const w = await deps.wikis.findById(input.id);
  if (!w) throw new Error(`Wiki not found: ${input.id}`);
  return w.schema;
}
