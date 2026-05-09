import { z } from 'zod';
import { CitationId } from './ids.ts';
import { Span } from './span.ts';

export const Citation = z.object({
  id: CitationId,
  label: z.string().min(1).max(200),
  span: Span,
});
export type Citation = z.infer<typeof Citation>;
