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
};
