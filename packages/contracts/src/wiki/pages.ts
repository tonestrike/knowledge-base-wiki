import { oc } from '@orpc/contract';
import { z } from 'zod';
import { Citation } from '../shared/citation.ts';
import { Claim } from '../shared/claim.ts';
import { WikiId, WikiPageId } from '../shared/ids.ts';

export const WikiPageSubtype = z.enum(['Concept', 'Summary', 'Answer', 'Index']);
export type WikiPageSubtype = z.infer<typeof WikiPageSubtype>;

export const Backlink = z.object({
  fromPageId: WikiPageId,
  toPageId: WikiPageId,
  relationName: z.string().min(1).optional(),
});
export type Backlink = z.infer<typeof Backlink>;

export const WikiPage = z.object({
  id: WikiPageId,
  wikiId: WikiId,
  subtype: WikiPageSubtype,
  pageType: z.string().optional(),
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  body: z.string(),
  claims: z.array(Claim),
  citations: z.array(Citation),
  backlinks: z.array(Backlink),
  updatedAt: z.string().datetime(),
});
export type WikiPage = z.infer<typeof WikiPage>;

export const GetPageInput = z.object({ id: WikiPageId });
export const ListPagesInput = z.object({
  wikiId: WikiId,
  subtype: WikiPageSubtype.optional(),
  pageType: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export const ListPagesOutput = z.object({
  items: z.array(WikiPage),
  nextCursor: z.string().optional(),
});

export const pagesContract = {
  getPage: oc
    .route({ method: 'GET', path: '/wiki-pages/{id}' })
    .input(GetPageInput)
    .output(WikiPage),
  listPages: oc
    .route({ method: 'GET', path: '/wiki-pages' })
    .input(ListPagesInput)
    .output(ListPagesOutput),
};
