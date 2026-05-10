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

// TD-16: `Span.contentHash` currently collapses two distinct invariants — the
// hash of the byte-range slice (what verification re-hashes against) vs. the
// hash of the whole source (what ingestion records on the `Source`). The
// type-design reviewer suggested introducing a `SliceHash` brand (or renaming
// to `Span.sliceHash`) so the stricter invariant is enforced at compile time.
//
// Deferred: the rename touches a large blast radius (D1 row encoders, every
// citation fixture, the `verify-citation` adapter, and the AnswerSegment
// wire shape). The fabrication tripwire still runs correctly today because
// `SourceHashVerifier` re-hashes the slice and rejects mismatches; the brand
// split is purely a type-level tightening. Tracked alongside the
// shared-kernel TD work in /docs/projects/0002-folder-wiki.md.
export const Span = z.object({
  sourceId: SourceId,
  byteRange: ByteRange,
  contentHash: ContentHash,
});
export type Span = z.infer<typeof Span>;

export const spanIdentity = (span: Span): string =>
  `${span.sourceId}:${span.byteRange.start}-${span.byteRange.end}:${span.contentHash}`;
