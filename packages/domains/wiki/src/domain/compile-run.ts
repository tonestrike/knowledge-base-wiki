import type { CompileRunId, FolderId, WikiId } from '@package/contracts/shared';

// CompileRun is a status-discriminated union: each variant carries exactly
// the fields valid in that state. wikiId/endedAt/failureMessage are NOT
// optional on every status — they're tied to the terminal variants.

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

interface BaseRun {
  readonly id: CompileRunId;
  readonly folderId: FolderId;
  readonly startedAt: string;
}

export interface PendingRun extends BaseRun {
  readonly status: 'pending';
}
export interface InferringSchemaRun extends BaseRun {
  readonly status: 'inferring-schema';
}
export interface PlanningRun extends BaseRun {
  readonly status: 'planning';
  readonly schemaInferredAt: string;
}
export interface ResearchingRun extends BaseRun {
  readonly status: 'researching';
  readonly schemaInferredAt: string;
}
export interface DraftingRun extends BaseRun {
  readonly status: 'drafting';
  readonly schemaInferredAt: string;
}
export interface LinkingRun extends BaseRun {
  readonly status: 'linking';
  readonly schemaInferredAt: string;
}
export interface IndexingRun extends BaseRun {
  readonly status: 'indexing';
  readonly schemaInferredAt: string;
}
export interface FinishedRun extends BaseRun {
  readonly status: 'finished';
  readonly schemaInferredAt: string;
  readonly wikiId: WikiId;
  readonly endedAt: string;
}
export interface FailedRun extends BaseRun {
  readonly status: 'failed';
  readonly schemaInferredAt?: string;
  readonly failureMessage: string;
  readonly endedAt: string;
}

export type CompileRun =
  | PendingRun
  | InferringSchemaRun
  | PlanningRun
  | ResearchingRun
  | DraftingRun
  | LinkingRun
  | IndexingRun
  | FinishedRun
  | FailedRun;

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

const isTerminal = (s: CompileRunStatus): boolean => s === 'finished' || s === 'failed';

const carriesSchemaInferredAt = (
  run: CompileRun,
): run is PlanningRun | ResearchingRun | DraftingRun | LinkingRun | IndexingRun | FinishedRun =>
  run.status === 'planning' ||
  run.status === 'researching' ||
  run.status === 'drafting' ||
  run.status === 'linking' ||
  run.status === 'indexing' ||
  run.status === 'finished';

export const CompileRun = {
  start(props: { id: CompileRunId; folderId: FolderId; startedAt: string }): PendingRun {
    return Object.freeze({ ...props, status: 'pending' as const });
  },
  advance(run: CompileRun, next: CompileRunStatus, at: string): CompileRun {
    if (isTerminal(run.status)) {
      throw new Error(`illegal transition ${run.status} → ${next} (terminal state)`);
    }
    const i = ORDER.indexOf(run.status);
    const j = ORDER.indexOf(next);
    if (j === -1 || j !== i + 1) {
      throw new Error(`illegal transition ${run.status} → ${next}`);
    }
    if (next === 'planning') {
      return Object.freeze({
        id: run.id,
        folderId: run.folderId,
        startedAt: run.startedAt,
        status: 'planning' as const,
        schemaInferredAt: at,
      });
    }
    // For all other transitions inside the inferring → indexing chain we
    // already carry schemaInferredAt (it was set on the planning step).
    if (
      next === 'researching' ||
      next === 'drafting' ||
      next === 'linking' ||
      next === 'indexing'
    ) {
      if (!carriesSchemaInferredAt(run)) {
        throw new Error(`cannot advance to ${next} without schemaInferredAt`);
      }
      return Object.freeze({
        id: run.id,
        folderId: run.folderId,
        startedAt: run.startedAt,
        status: next,
        schemaInferredAt: run.schemaInferredAt,
      });
    }
    if (next === 'inferring-schema') {
      return Object.freeze({
        id: run.id,
        folderId: run.folderId,
        startedAt: run.startedAt,
        status: 'inferring-schema' as const,
      });
    }
    // Should not reach: 'finished' / 'failed' must go through finish/fail.
    throw new Error(`use finish() / fail() to enter terminal state ${next}`);
  },
  finish(run: CompileRun, props: { wikiId: WikiId; endedAt: string }): FinishedRun {
    if (run.status !== 'indexing') throw new Error(`cannot finish from ${run.status}`);
    return Object.freeze({
      id: run.id,
      folderId: run.folderId,
      startedAt: run.startedAt,
      schemaInferredAt: run.schemaInferredAt,
      status: 'finished' as const,
      wikiId: props.wikiId,
      endedAt: props.endedAt,
    });
  },
  fail(run: CompileRun, message: string, at: string): FailedRun {
    return Object.freeze({
      id: run.id,
      folderId: run.folderId,
      startedAt: run.startedAt,
      schemaInferredAt: carriesSchemaInferredAt(run) ? run.schemaInferredAt : undefined,
      status: 'failed' as const,
      failureMessage: message,
      endedAt: at,
    });
  },
};
