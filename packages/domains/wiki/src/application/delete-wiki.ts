import type { WikiId } from '@package/contracts/shared';
import type { WikiPageRepository, WikiRepository } from './ports.ts';

export interface DeleteWikiDeps {
  wikis: WikiRepository;
  pages: WikiPageRepository;
}

export interface DeleteWikiInput {
  readonly id: WikiId;
}

export interface DeleteWikiOutput {
  readonly deletedPageCount: number;
}

/**
 * Cascade-delete a wiki and every artefact that hangs off it: D1 rows
 * (citations → claims → backlinks → wiki_pages → wikis) plus the R2
 * page-body objects keyed by `<page id>`.
 *
 * Idempotent: deleting a wiki that doesn't exist returns
 * `{ deletedPageCount: 0 }` instead of erroring, so a stale UI tab
 * acting on a stale id can't crash the api.
 */
export async function deleteWiki(
  deps: DeleteWikiDeps,
  input: DeleteWikiInput,
): Promise<DeleteWikiOutput> {
  const { deletedPageIds } = await deps.wikis.cascadeDelete(input.id);
  await deps.pages.deleteBodies(deletedPageIds);
  return { deletedPageCount: deletedPageIds.length };
}
