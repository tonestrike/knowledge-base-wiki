import type { ListWikisOutput } from '@package/contracts/wiki';
import type { z } from 'zod';
import type { WikiDeps } from './ports.ts';

export async function listWikis(
  deps: Pick<WikiDeps, 'wikis'>,
  input: { cursor?: string; limit: number },
): Promise<z.infer<typeof ListWikisOutput>> {
  const { items, nextCursor } = await deps.wikis.list(input);
  return { items: items.map((w) => deps.wikis.toWire(w)), nextCursor };
}
