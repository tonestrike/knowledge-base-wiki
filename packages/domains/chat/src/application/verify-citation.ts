import type { Citation, SourceId } from '@package/contracts/shared';
import type { SourceHashVerifier } from './ports.ts';

export interface SourceHashVerifierDeps {
  readSourceText(sourceId: SourceId): Promise<string | null>;
  sha256Hex(slice: string): Promise<string>;
}

/**
 * Build a `SourceHashVerifier` that re-hashes the bytes a `Citation`'s `Span`
 * covers and compares to `Span.contentHash`. A mismatch — or a missing source
 * — fails verification and the calling Synthesizer aborts the Turn.
 *
 * The contract layer's `Span.contentHash` is documented as the *whole-source*
 * hash; this verifier intentionally hashes only the slice. That's a stricter
 * invariant: if the underlying source bytes shift, the slice hash will change
 * and the Citation will be rejected even though the whole-source hash might
 * still pass. The slice plan flagged this divergence.
 */
export const createMemorySourceHashVerifier = (
  deps: SourceHashVerifierDeps,
): SourceHashVerifier => ({
  async verify(citation: Citation) {
    const text = await deps.readSourceText(citation.span.sourceId);
    if (text == null) {
      return { ok: false, reason: `source text not found: ${citation.span.sourceId}` };
    }
    const { start, end } = citation.span.byteRange;
    if (end > text.length) {
      return {
        ok: false,
        reason: `byte range overruns source text (${end} > ${text.length})`,
      };
    }
    const slice = text.slice(start, end);
    const hash = await deps.sha256Hex(slice);
    if (hash !== citation.span.contentHash) {
      return { ok: false, reason: `hash mismatch: ${hash} vs ${citation.span.contentHash}` };
    }
    return { ok: true };
  },
});
