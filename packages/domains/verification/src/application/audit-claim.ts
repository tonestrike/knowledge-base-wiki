import type { Claim } from '@package/contracts/shared';
import { Correction } from '../domain/correction.ts';
import type { Verdict } from '../domain/lint-finding.ts';
import type { AnthropicVerifier, SourceTextReader } from './ports.ts';

export interface AuditClaimResult {
  verdict: Verdict;
  evidenceText: string;
  correction?: Correction;
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
    slices.push({ citationId: c.id, sliceText: slice ?? '<missing>' });
  }
  const out = await deps.verifier.audit({ claim: input.claim, citedSlices: slices });
  if (out.verdict !== 'supported' && !out.correction) {
    throw new Error(
      `Verifier returned non-supported verdict without a Correction (claim ${input.claim.id})`,
    );
  }
  return {
    verdict: out.verdict,
    evidenceText: out.evidenceText,
    correction: out.correction ? Correction.create(out.correction) : undefined,
  };
}
