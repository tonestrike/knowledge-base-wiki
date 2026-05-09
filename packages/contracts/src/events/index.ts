import { z } from 'zod';
import {
  CitationId,
  ClaimId,
  CompileRunId,
  ConversationId,
  FolderId,
  LintFindingId,
  LintRunId,
  SourceId,
  TurnId,
  WikiId,
  WikiPageId,
} from '../shared/ids.ts';
import { ContentHash } from '../shared/span.ts';
import { WikiSchema } from '../shared/wiki-schema.ts';

const eventEnvelope = <Name extends string, Payload extends z.ZodTypeAny>(
  name: Name,
  payload: Payload,
) =>
  z.object({
    name: z.literal(name),
    occurredAt: z.string().datetime(),
    payload,
  });

export const SourceIngested = eventEnvelope(
  'SourceIngested',
  z.object({
    sourceId: SourceId,
    folderId: FolderId,
    contentHash: ContentHash,
    filename: z.string().min(1),
  }),
);
export type SourceIngested = z.infer<typeof SourceIngested>;

export const SchemaInferred = eventEnvelope(
  'SchemaInferred',
  z.object({
    compileRunId: CompileRunId,
    wikiId: WikiId,
    schema: WikiSchema,
  }),
);
export type SchemaInferred = z.infer<typeof SchemaInferred>;

export const CompileFinished = eventEnvelope(
  'CompileFinished',
  z.object({
    compileRunId: CompileRunId,
    wikiId: WikiId,
    pageCount: z.number().int().nonnegative(),
  }),
);
export type CompileFinished = z.infer<typeof CompileFinished>;

export const AnswerProduced = eventEnvelope(
  'AnswerProduced',
  z.object({
    conversationId: ConversationId,
    turnId: TurnId,
    wikiId: WikiId,
  }),
);
export type AnswerProduced = z.infer<typeof AnswerProduced>;

export const CorrectionAccepted = eventEnvelope(
  'CorrectionAccepted',
  z.object({
    lintRunId: LintRunId,
    lintFindingId: LintFindingId,
    wikiPageId: WikiPageId,
    claimId: ClaimId,
    replacementText: z.string().min(1).max(2000),
    newCitationId: CitationId.optional(),
  }),
);
export type CorrectionAccepted = z.infer<typeof CorrectionAccepted>;

export const DomainEvent = z.discriminatedUnion('name', [
  SourceIngested,
  SchemaInferred,
  CompileFinished,
  AnswerProduced,
  CorrectionAccepted,
]);
export type DomainEvent = z.infer<typeof DomainEvent>;
