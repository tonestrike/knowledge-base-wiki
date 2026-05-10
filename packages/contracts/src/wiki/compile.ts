import { eventIterator, oc } from '@orpc/contract';
import { z } from 'zod';
import { CompileRunId, FolderId, SourceId, WikiId, WikiPageId } from '../shared/ids.ts';
import { WikiSchema } from '../shared/wiki-schema.ts';
import { WikiPageSubtype } from './pages.ts';

export const CompileRunStatus = z.enum([
  'pending',
  'inferring-schema',
  'planning',
  'researching',
  'drafting',
  'linking',
  'indexing',
  'finished',
  'failed',
]);
export type CompileRunStatus = z.infer<typeof CompileRunStatus>;

export const CompileRun = z.object({
  id: CompileRunId,
  folderId: FolderId,
  wikiId: WikiId.optional(),
  status: CompileRunStatus,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  schemaInferredAt: z.string().datetime().optional(),
});
export type CompileRun = z.infer<typeof CompileRun>;

export const StartCompileInput = z.object({ folderId: FolderId });
export const StartCompileOutput = z.object({
  compileRunId: CompileRunId,
});

export const GetCompileRunInput = z.object({ id: CompileRunId });

export const StreamCompileInput = z.object({ compileRunId: CompileRunId });

export const CompileStarted = z.object({
  kind: z.literal('CompileStarted'),
  compileRunId: CompileRunId,
  folderId: FolderId,
  sourceCount: z.number().int().nonnegative(),
});

export const SchemaInferredEvent = z.object({
  kind: z.literal('SchemaInferred'),
  compileRunId: CompileRunId,
  schema: WikiSchema,
  reason: z.string().min(1),
});

export const PageDrafted = z.object({
  kind: z.literal('PageDrafted'),
  compileRunId: CompileRunId,
  pageId: WikiPageId,
  subtype: WikiPageSubtype,
  pageType: z.string().optional(),
  title: z.string(),
  fromSourceId: SourceId.optional(),
});

export const BacklinkResolved = z.object({
  kind: z.literal('BacklinkResolved'),
  compileRunId: CompileRunId,
  fromPageId: WikiPageId,
  toPageId: WikiPageId,
  relationName: z.string().optional(),
});

// SF5 / TD1 — arity violations are dropped from the Wiki, but emitted as
// a typed event so downstream surfaces (live theater + 2.D verification)
// can show "we tried to link X→Y as relation R but cardinality forbade it".
export const BacklinkArityViolated = z.object({
  kind: z.literal('BacklinkArityViolated'),
  compileRunId: CompileRunId,
  fromPageId: WikiPageId,
  toPageId: WikiPageId,
  relationName: z.string(),
  cardinality: z.string(),
  reason: z.string(),
});

// SF1 — per-source Researcher failures don't kill the run; we drop the
// source's findings and emit one ResearchFailed so the user sees which
// source broke and why.
export const ResearchFailed = z.object({
  kind: z.literal('ResearchFailed'),
  compileRunId: CompileRunId,
  sourceId: SourceId,
  message: z.string(),
});

export const IndexBuilt = z.object({
  kind: z.literal('IndexBuilt'),
  compileRunId: CompileRunId,
  pageType: z.string(),
  pageCount: z.number().int().nonnegative(),
});

export const CompileFailed = z.object({
  kind: z.literal('CompileFailed'),
  compileRunId: CompileRunId,
  message: z.string(),
});

export const CompileFinishedEvent = z.object({
  kind: z.literal('CompileFinished'),
  compileRunId: CompileRunId,
  wikiId: WikiId,
  pageCount: z.number().int().nonnegative(),
});

export const CompileEvent = z.discriminatedUnion('kind', [
  CompileStarted,
  SchemaInferredEvent,
  PageDrafted,
  BacklinkResolved,
  BacklinkArityViolated,
  ResearchFailed,
  IndexBuilt,
  CompileFailed,
  CompileFinishedEvent,
]);
export type CompileEvent = z.infer<typeof CompileEvent>;

export const compileContract = {
  startCompile: oc
    .route({ method: 'POST', path: '/compile-runs' })
    .input(StartCompileInput)
    .output(StartCompileOutput),
  getCompileRun: oc
    .route({ method: 'GET', path: '/compile-runs/{id}' })
    .input(GetCompileRunInput)
    .output(CompileRun),
  streamCompileEvents: oc
    .route({ method: 'GET', path: '/compile-runs/{compileRunId}/events' })
    .input(StreamCompileInput)
    .output(eventIterator(CompileEvent)),
};
