import { z } from 'zod';
import { Citation } from './citation.ts';
import { ClaimId, WikiPageId } from './ids.ts';

export const Claim = z.object({
  id: ClaimId,
  wikiPageId: WikiPageId,
  paragraphId: z.string().min(1),
  claimText: z.string().min(1).max(2000),
  citations: z.array(Citation).min(1, { message: 'a Claim must have at least one citation' }),
});
export type Claim = z.infer<typeof Claim>;
