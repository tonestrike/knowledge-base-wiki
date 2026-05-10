import { z } from 'zod';
import { ContentHash, SourceId } from './ids.ts';

// Re-export so existing `import { ContentHash, contentHash } from '.../span'`
// call sites keep working. The canonical home is now `ids.ts` (TD5).
export { ContentHash, contentHash } from './ids.ts';

export const ByteRange = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .refine((r) => r.end > r.start, {
    message: 'byte range must have positive length',
  });
export type ByteRange = z.infer<typeof ByteRange>;

export const Span = z.object({
  sourceId: SourceId,
  byteRange: ByteRange,
  contentHash: ContentHash,
});
export type Span = z.infer<typeof Span>;

export const spanIdentity = (span: Span): string =>
  `${span.sourceId}:${span.byteRange.start}-${span.byteRange.end}:${span.contentHash}`;
