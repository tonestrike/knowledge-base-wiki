import { ORPCError, implement } from '@orpc/server';
import { verificationContract } from '@package/contracts/verification';
import type { Clock } from '@package/shared-kernel';

export interface VerificationContext {
  clock: Clock;
}

const os = implement(verificationContract).$context<VerificationContext>();

const todo = (procedure: string): never => {
  throw new ORPCError('NOT_IMPLEMENTED', {
    message: `verification.${procedure} is scaffolded but not implemented (Slice 2.D)`,
  });
};

export const verificationRouter = {
  start: os.start.handler(() => todo('start')),
  getLintRun: os.getLintRun.handler(() => todo('getLintRun')),
  listLintRuns: os.listLintRuns.handler(() => todo('listLintRuns')),
  // biome-ignore lint/correctness/useYield: stub generator throws before yielding (Slice 2.D wires the real stream)
  streamLintEvents: os.streamLintEvents.handler(async function* () {
    todo('streamLintEvents');
  }),
  getFinding: os.getFinding.handler(() => todo('getFinding')),
  listFindings: os.listFindings.handler(() => todo('listFindings')),
  applyCorrection: os.applyCorrection.handler(() => todo('applyCorrection')),
};
