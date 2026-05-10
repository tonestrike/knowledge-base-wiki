import type { LintFindingId } from '@package/contracts/shared';
import { LintFinding } from '../domain/lint-finding.ts';
import type { VerificationDeps } from './ports.ts';

export interface ApplyCorrectionResult {
  appliedAt: string;
}

// Apply an accepted Correction.
//
// Consistency model (see PR #6 silent-failure-hunter finding 7):
// We publish CorrectionAccepted FIRST, then mark the finding resolved. This
// inverts the prior order so a successful publish is never followed by a
// silent state divergence. Concretely:
//
//   - publish succeeds, update succeeds → desired state.
//   - publish fails, update never runs → caller sees error, retry is safe.
//   - publish succeeds, update fails    → caller sees error, retry republishes
//     CorrectionAccepted; the wiki-side handler MUST be idempotent on
//     `lintFindingId` (it already keys its applied-set on the finding id) and
//     a subsequent retry's update finishes the cycle.
//
// The correct long-term fix is the transactional outbox pattern (event row
// inserted in the same D1 batch as the finding update, then drained by a
// relayer). That is deferred — tracked at /docs/projects/0002-folder-wiki.md
// as part of the eventBus production hardening work that PR #7 is
// coordinating. Until then, idempotency on the consumer side is the contract.
export async function applyCorrection(
  deps: VerificationDeps,
  input: { lintFindingId: LintFindingId },
): Promise<ApplyCorrectionResult> {
  const f = await deps.findings.findById(input.lintFindingId);
  if (!f) {
    throw new Error(`LintFinding not found: ${input.lintFindingId}`);
  }
  if (!f.correction) {
    throw new Error(`LintFinding ${f.id} has no Correction to apply`);
  }
  if (f.resolvedAt) {
    throw new Error(`LintFinding ${f.id} already resolved at ${f.resolvedAt}`);
  }

  const at = deps.now().toISOString();

  await deps.eventBus.publish({
    name: 'CorrectionAccepted',
    occurredAt: at,
    payload: {
      lintRunId: f.lintRunId,
      lintFindingId: f.id,
      wikiPageId: f.wikiPageId,
      claimId: f.claimId,
      replacementText: f.correction.replacementText,
    },
  });

  const resolved = LintFinding.resolve(f, at);
  await deps.findings.update(resolved);

  return { appliedAt: at };
}
