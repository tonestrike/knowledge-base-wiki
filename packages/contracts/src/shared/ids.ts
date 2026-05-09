import { z } from 'zod';

const brand = <Name extends string>(_name: Name) => z.string().uuid().brand<Name>();

export const SourceId = brand('SourceId');
export type SourceId = z.infer<typeof SourceId>;
export const sourceId = (s: string): SourceId => SourceId.parse(s);

export const FolderId = brand('FolderId');
export type FolderId = z.infer<typeof FolderId>;
export const folderId = (s: string): FolderId => FolderId.parse(s);

export const WikiId = brand('WikiId');
export type WikiId = z.infer<typeof WikiId>;
export const wikiId = (s: string): WikiId => WikiId.parse(s);

export const WikiPageId = brand('WikiPageId');
export type WikiPageId = z.infer<typeof WikiPageId>;
export const wikiPageId = (s: string): WikiPageId => WikiPageId.parse(s);

export const ClaimId = brand('ClaimId');
export type ClaimId = z.infer<typeof ClaimId>;
export const claimId = (s: string): ClaimId => ClaimId.parse(s);

export const CitationId = brand('CitationId');
export type CitationId = z.infer<typeof CitationId>;
export const citationId = (s: string): CitationId => CitationId.parse(s);

export const CompileRunId = brand('CompileRunId');
export type CompileRunId = z.infer<typeof CompileRunId>;
export const compileRunId = (s: string): CompileRunId => CompileRunId.parse(s);

export const ConversationId = brand('ConversationId');
export type ConversationId = z.infer<typeof ConversationId>;
export const conversationId = (s: string): ConversationId => ConversationId.parse(s);

export const TurnId = brand('TurnId');
export type TurnId = z.infer<typeof TurnId>;
export const turnId = (s: string): TurnId => TurnId.parse(s);

export const LintRunId = brand('LintRunId');
export type LintRunId = z.infer<typeof LintRunId>;
export const lintRunId = (s: string): LintRunId => LintRunId.parse(s);

export const LintFindingId = brand('LintFindingId');
export type LintFindingId = z.infer<typeof LintFindingId>;
export const lintFindingId = (s: string): LintFindingId => LintFindingId.parse(s);

export const UserId = brand('UserId');
export type UserId = z.infer<typeof UserId>;
export const userId = (s: string): UserId => UserId.parse(s);
