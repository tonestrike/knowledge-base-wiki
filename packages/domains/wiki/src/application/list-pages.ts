import type { WikiId } from '@package/contracts/shared';
import type { ListPagesOutput, WikiPageSubtype } from '@package/contracts/wiki';
import type { z } from 'zod';
import type { WikiDeps } from './ports.ts';

export async function listPages(
  deps: Pick<WikiDeps, 'pages'>,
  input: {
    wikiId: WikiId;
    subtype?: WikiPageSubtype;
    pageType?: string;
    cursor?: string;
    limit: number;
  },
): Promise<z.infer<typeof ListPagesOutput>> {
  const { items, nextCursor } = await deps.pages.list(input);
  return { items: items.map((p) => deps.pages.toWire(p)), nextCursor };
}
