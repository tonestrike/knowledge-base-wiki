import type { WikiId } from '@package/contracts/shared';
import type { LintRun as LintRunWire } from '@package/contracts/verification';
import type { VerificationDeps } from './ports.ts';

export async function listLintRuns(
  deps: Pick<VerificationDeps, 'runs'>,
  input: { wikiId?: WikiId; cursor?: string; limit: number },
): Promise<{ items: LintRunWire[]; nextCursor?: string }> {
  const page = await deps.runs.list(input);
  return {
    items: page.items.map((r) => deps.runs.toWire(r)),
    nextCursor: page.nextCursor,
  };
}
