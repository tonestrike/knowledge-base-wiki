import type { WikiId } from '@package/contracts/shared';
import type { Wiki as WikiWire } from '@package/contracts/wiki';
import type { WikiDeps } from './ports.ts';

export async function getWiki(
  deps: Pick<WikiDeps, 'wikis'>,
  input: { id: WikiId },
): Promise<WikiWire> {
  const w = await deps.wikis.findById(input.id);
  if (!w) throw new Error(`Wiki not found: ${input.id}`);
  return deps.wikis.toWire(w);
}
