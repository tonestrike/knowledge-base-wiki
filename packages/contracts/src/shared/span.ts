import { z } from 'zod';
import { SourceId } from './ids.ts';

export const ByteRange = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .refine((r) => r.end > r.start, {
    message: 'byte range must have positive length',
  });
export type ByteRange = z.infer<typeof ByteRange>;

export const ContentHash = z
  .string()
  .regex(/^[a-z0-9]+:[a-f0-9]+$/, 'content hash must be `<algo>:<hex>`');
export type ContentHash = z.infer<typeof ContentHash>;

export const Span = z.object({
  sourceId: SourceId,
  byteRange: ByteRange,
  contentHash: ContentHash,
});
export type Span = z.infer<typeof Span>;

export const spanIdentity = (span: Span): string =>
  `${span.sourceId}:${span.byteRange.start}-${span.byteRange.end}:${span.contentHash}`;
