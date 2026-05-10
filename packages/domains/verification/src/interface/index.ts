import { ORPCError, implement } from '@orpc/server';
import { lintRunId } from '@package/contracts/shared';
import { verificationContract } from '@package/contracts/verification';
import type { Clock } from '@package/shared-kernel';
import { applyCorrection } from '../application/apply-correction.ts';
import { getFinding } from '../application/get-finding.ts';
import { getLintRun } from '../application/get-lint-run.ts';
import { listFindings } from '../application/list-findings.ts';
import { listLintRuns } from '../application/list-lint-runs.ts';
import type { VerificationDeps } from '../application/ports.ts';

export interface VerificationContext extends Partial<VerificationDeps> {
  clock: Clock;
}

const os = implement(verificationContract).$context<VerificationContext>();

const requireDeps = <K extends keyof VerificationDeps>(
  context: VerificationContext,
  ...keys: K[]
): Pick<VerificationDeps, K> => {
  const missing = keys.filter((k) => context[k] === undefined);
  if (missing.length > 0) {
    throw new ORPCError('NOT_IMPLEMENTED', {
      message: `verification dependencies not wired: ${missing.join(', ')}`,
    });
  }
  return context as unknown as Pick<VerificationDeps, K>;
};

export const verificationRouter = {
  start: os.start.handler(async ({ context, input }) => {
    const deps = requireDeps(context, 'newId', 'dispatcher');
    const id = lintRunId(deps.newId());
    await deps.dispatcher.start({ lintRunId: id, wikiId: input.wikiId });
    return { lintRunId: id };
  }),

  getLintRun: os.getLintRun.handler(async ({ context, input }) => {
    const deps = requireDeps(context, 'runs');
    return getLintRun(deps, input);
  }),

  listLintRuns: os.listLintRuns.handler(async ({ context, input }) => {
    const deps = requireDeps(context, 'runs');
    return listLintRuns(deps, input);
  }),

  streamLintEvents: os.streamLintEvents.handler(async function* ({ context, input }) {
    const deps = requireDeps(context, 'dispatcher');
    for await (const event of deps.dispatcher.subscribe(input.lintRunId)) {
      yield event;
    }
  }),

  getFinding: os.getFinding.handler(async ({ context, input }) => {
    const deps = requireDeps(context, 'findings');
    return getFinding(deps, input);
  }),

  listFindings: os.listFindings.handler(async ({ context, input }) => {
    const deps = requireDeps(context, 'findings');
    return listFindings(deps, input);
  }),

  applyCorrection: os.applyCorrection.handler(async ({ context, input }) => {
    const deps = requireDeps(context, 'findings', 'eventBus', 'now');
    return applyCorrection(deps as VerificationDeps, input);
  }),
};
