import type { LintRunId } from '@package/contracts/shared';
import type { LintRun as LintRunWire } from '@package/contracts/verification';
import type { VerificationDeps } from './ports.ts';

export async function getLintRun(
  deps: Pick<VerificationDeps, 'runs'>,
  input: { id: LintRunId },
): Promise<LintRunWire> {
  const run = await deps.runs.findById(input.id);
  if (!run) {
    throw new Error(`LintRun not found: ${input.id}`);
  }
  return deps.runs.toWire(run);
}
