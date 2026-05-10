import type { LintRunId } from '@package/contracts/shared';
import type { LintFinding as LintFindingWire } from '@package/contracts/verification';
import type { Verdict } from '../domain/lint-finding.ts';
import type { VerificationDeps } from './ports.ts';

export async function listFindings(
  deps: Pick<VerificationDeps, 'findings'>,
  input: { lintRunId: LintRunId; verdict?: Verdict; cursor?: string; limit: number },
): Promise<{ items: LintFindingWire[]; nextCursor?: string }> {
  const page = await deps.findings.list(input);
  return {
    items: page.items.map((f) => deps.findings.toWire(f)),
    nextCursor: page.nextCursor,
  };
}
