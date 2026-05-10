import type { LintFindingId } from '@package/contracts/shared';
import type { LintFinding as LintFindingWire } from '@package/contracts/verification';
import type { VerificationDeps } from './ports.ts';

export async function getFinding(
  deps: Pick<VerificationDeps, 'findings'>,
  input: { id: LintFindingId },
): Promise<LintFindingWire> {
  const f = await deps.findings.findById(input.id);
  if (!f) {
    throw new Error(`LintFinding not found: ${input.id}`);
  }
  return deps.findings.toWire(f);
}
