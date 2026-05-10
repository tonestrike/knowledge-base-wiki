import type { LintFindingId } from '@package/contracts/shared';
import { LintFinding } from '../domain/lint-finding.ts';
import type { VerificationDeps } from './ports.ts';

export interface ApplyCorrectionResult {
  appliedAt: string;
}

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
  const resolved = LintFinding.resolve(f, at);
  await deps.findings.update(resolved);

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

  return { appliedAt: at };
}
