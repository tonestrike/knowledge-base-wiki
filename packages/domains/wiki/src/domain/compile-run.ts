import type { CompileRunId, FolderId, WikiId } from '@package/contracts/shared';

export type CompileRunStatus =
  | 'pending'
  | 'inferring-schema'
  | 'planning'
  | 'researching'
  | 'drafting'
  | 'linking'
  | 'indexing'
  | 'finished'
  | 'failed';

const ORDER: CompileRunStatus[] = [
  'pending',
  'inferring-schema',
  'planning',
  'researching',
  'drafting',
  'linking',
  'indexing',
  'finished',
];

export interface CompileRun {
  readonly id: CompileRunId;
  readonly folderId: FolderId;
  readonly wikiId?: WikiId;
  readonly status: CompileRunStatus;
  readonly startedAt: string;
  readonly schemaInferredAt?: string;
  readonly endedAt?: string;
  readonly failureMessage?: string;
}

export const CompileRun = {
  start(props: { id: CompileRunId; folderId: FolderId; startedAt: string }): CompileRun {
    return Object.freeze({ ...props, status: 'pending' as const });
  },
  advance(run: CompileRun, next: CompileRunStatus, at: string): CompileRun {
    if (run.status === 'failed' || run.status === 'finished') {
      throw new Error(`illegal transition ${run.status} → ${next} (terminal state)`);
    }
    const i = ORDER.indexOf(run.status);
    const j = ORDER.indexOf(next);
    if (j === -1 || j !== i + 1) {
      throw new Error(`illegal transition ${run.status} → ${next}`);
    }
    const patch =
      next === 'planning' && run.schemaInferredAt === undefined ? { schemaInferredAt: at } : {};
    return Object.freeze({ ...run, ...patch, status: next });
  },
  finish(run: CompileRun, props: { wikiId: WikiId; endedAt: string }): CompileRun {
    if (run.status !== 'indexing') throw new Error(`cannot finish from ${run.status}`);
    return Object.freeze({
      ...run,
      status: 'finished' as const,
      wikiId: props.wikiId,
      endedAt: props.endedAt,
    });
  },
  fail(run: CompileRun, message: string, at: string): CompileRun {
    return Object.freeze({
      ...run,
      status: 'failed' as const,
      failureMessage: message,
      endedAt: at,
    });
  },
};
