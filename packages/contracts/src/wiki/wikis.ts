import { oc } from '@orpc/contract';
import { z } from 'zod';
import { FolderId, WikiId } from '../shared/ids.ts';
import { WikiSchema } from '../shared/wiki-schema.ts';

export const Wiki = z.object({
  id: WikiId,
  folderId: FolderId,
  schema: WikiSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastCompiledAt: z.string().datetime().optional(),
  pageCount: z.number().int().nonnegative(),
  /**
   * Perspective text the compile ran under. When set, the compile prompts
   * (SchemaInferrer, PlanCompile, ResearchSource, DraftPage, NarrateIndexes)
   * were biased toward this lens. Surfaced in the UI so readers see what
   * the wiki was tuned for.
   */
  perspective: z.string().optional(),
});
export type Wiki = z.infer<typeof Wiki>;

export const GetWikiInput = z.object({ id: WikiId });
export const GetSchemaInput = z.object({ id: WikiId });
export const ListWikisInput = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export const ListWikisOutput = z.object({
  items: z.array(Wiki),
  nextCursor: z.string().optional(),
});

export const GapsInput = z.object({ id: WikiId });

export const Gap = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('PageTypeHasNoPages'),
    pageType: z.string(),
    description: z.string(),
  }),
  z.object({
    kind: z.literal('PageHasNoClaims'),
    pageId: z.string().uuid(),
    title: z.string(),
    pageType: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('ClaimHasNoCitations'),
    pageId: z.string().uuid(),
    pageTitle: z.string(),
    claimId: z.string().uuid(),
    claimText: z.string(),
  }),
  z.object({
    kind: z.literal('SourceNeverCited'),
    sourceId: z.string().uuid(),
    filename: z.string(),
  }),
]);
export type Gap = z.infer<typeof Gap>;

export const GapsOutput = z.object({
  wikiId: WikiId,
  generatedAt: z.string().datetime(),
  totalGaps: z.number().int().nonnegative(),
  gaps: z.array(Gap),
});
export type GapsOutput = z.infer<typeof GapsOutput>;

export const DeleteWikiInput = z.object({ id: WikiId });
export const DeleteWikiOutput = z.object({
  deletedPageCount: z.number().int().nonnegative(),
});
export type DeleteWikiOutput = z.infer<typeof DeleteWikiOutput>;

export const wikisContract = {
  getWiki: oc.route({ method: 'GET', path: '/wikis/{id}' }).input(GetWikiInput).output(Wiki),
  getSchema: oc
    .route({ method: 'GET', path: '/wikis/{id}/schema' })
    .input(GetSchemaInput)
    .output(WikiSchema),
  listWikis: oc
    .route({ method: 'GET', path: '/wikis' })
    .input(ListWikisInput)
    .output(ListWikisOutput),
  // Wiki health / gap analysis. Surfaces structural gaps in the compile —
  // claims with no citations, schema PageTypes with no pages, sources
  // never cited, etc. Cheap D1 queries; runs on demand.
  gaps: oc.route({ method: 'GET', path: '/wikis/{id}/gaps' }).input(GapsInput).output(GapsOutput),
  // Cascade-delete a wiki + all its pages, claims, citations, backlinks,
  // and R2 page bodies. Idempotent: deleting a wiki that doesn't exist
  // returns `{ deletedPageCount: 0 }` instead of erroring.
  deleteWiki: oc
    .route({ method: 'POST', path: '/wikis/{id}/delete' })
    .input(DeleteWikiInput)
    .output(DeleteWikiOutput),
};
