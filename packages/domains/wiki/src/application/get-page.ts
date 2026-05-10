import type { WikiPageId } from '@package/contracts/shared';
import type { WikiPage as WikiPageWire } from '@package/contracts/wiki';
import type { WikiDeps } from './ports.ts';

export async function getPage(
  deps: Pick<WikiDeps, 'pages'>,
  input: { id: WikiPageId },
): Promise<WikiPageWire> {
  const p = await deps.pages.findById(input.id);
  if (!p) throw new Error(`WikiPage not found: ${input.id}`);
  return deps.pages.toWire(p);
}
