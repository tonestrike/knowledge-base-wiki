import type { Claim } from '@package/contracts/shared';
import { Correction } from '../domain/correction.ts';
import type { Verdict } from '../domain/lint-finding.ts';
import type { AnthropicVerifier, SourceTextReader } from './ports.ts';

export interface AuditClaimResult {
  verdict: Verdict;
  evidenceText: string;
  correction?: Correction;
}

// Thrown when one or more cited Spans cannot be read from the SourceTextReader.
// Distinct from a content verdict — the linting infrastructure failed, not the
// claim. lintWiki catches this and emits an audit-failure finding rather than
// letting the Verifier render judgment against a sentinel string (see PR #6
// silent-failure-hunter finding 5).
export class CitationUnreadableError extends Error {
  readonly citationId: string;
  constructor(citationId: string, sourceId: string) {
    super(`citation ${citationId} unreadable: source ${sourceId} returned null`);
    this.name = 'CitationUnreadableError';
    this.citationId = citationId;
  }
}

export async function auditClaim(
  deps: { verifier: AnthropicVerifier; sourceText: SourceTextReader },
  input: { claim: Claim },
): Promise<AuditClaimResult> {
  const slices: Array<{ citationId: string; sliceText: string }> = [];
  for (const c of input.claim.citations) {
    const slice = await deps.sourceText.readSlice({
      sourceId: c.span.sourceId,
      byteRange: c.span.byteRange,
    });
    if (slice === null) {
      throw new CitationUnreadableError(c.id, c.span.sourceId);
    }
    slices.push({ citationId: c.id, sliceText: slice });
  }
  const out = await deps.verifier.audit({ claim: input.claim, citedSlices: slices });
  // Exhaustive switch on verdict (PR #6 type-design finding) — adding a new
  // variant must light up here as a non-exhaustive switch error rather than
  // silently fall through.
  switch (out.verdict) {
    case 'supported':
      return {
        verdict: 'supported',
        evidenceText: out.evidenceText,
        correction: out.correction ? Correction.create(out.correction) : undefined,
      };
    case 'unsupported':
    case 'contradicted': {
      if (!out.correction) {
        throw new Error(
          `Verifier returned ${out.verdict} verdict without a Correction (claim ${input.claim.id})`,
        );
      }
      return {
        verdict: out.verdict,
        evidenceText: out.evidenceText,
        correction: Correction.create(out.correction),
      };
    }
  }
}
