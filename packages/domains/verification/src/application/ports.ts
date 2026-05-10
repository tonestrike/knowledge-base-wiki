import type {
  Citation,
  Claim,
  ClaimId,
  LintFindingId,
  LintRunId,
  SourceId,
  WikiId,
  WikiPageId,
} from '@package/contracts/shared';
import type {
  LintEvent,
  LintFinding as LintFindingWire,
  LintRun as LintRunWire,
} from '@package/contracts/verification';
import type { EventBus } from '@package/shared-kernel';
import type { LintFinding } from '../domain/lint-finding.ts';
import type { LintRun } from '../domain/lint-run.ts';

// The Verifier port. The infrastructure adapter wraps Vercel AI SDK's
// generateObject() against OpenRouter's Opus 4.7 endpoint at temperature 0.
export interface AnthropicVerifier {
  audit(args: {
    claim: Claim;
    citedSlices: ReadonlyArray<{ citationId: string; sliceText: string }>;
  }): Promise<{
    verdict: 'supported' | 'unsupported' | 'contradicted';
    evidenceText: string;
    correction?: { replacementText: string; newCitationLabel?: string };
  }>;
}

export interface ClaimReader {
  listClaimsForWiki(
    wikiId: WikiId,
  ): Promise<ReadonlyArray<{ wikiPageId: WikiPageId; claim: Claim }>>;
  listWikiIds(): Promise<ReadonlyArray<WikiId>>;
}

export interface SourceTextReader {
  readSlice(args: {
    sourceId: SourceId;
    byteRange: { start: number; end: number };
  }): Promise<string | null>;
}

export interface LintRunRepository {
  insert(r: LintRun): Promise<void>;
  update(r: LintRun): Promise<void>;
  findById(id: LintRunId): Promise<LintRun | null>;
  list(args: {
    wikiId?: WikiId;
    cursor?: string;
    limit: number;
  }): Promise<{ items: LintRun[]; nextCursor?: string }>;
  toWire(r: LintRun): LintRunWire;
}

export interface LintFindingRepository {
  insertMany(fs: ReadonlyArray<LintFinding>): Promise<void>;
  update(f: LintFinding): Promise<void>;
  findById(id: LintFindingId): Promise<LintFinding | null>;
  list(args: {
    lintRunId: LintRunId;
    verdict?: 'supported' | 'unsupported' | 'contradicted';
    cursor?: string;
    limit: number;
  }): Promise<{ items: LintFinding[]; nextCursor?: string }>;
  toWire(f: LintFinding): LintFindingWire;
}

export interface LintRunDispatcher {
  start(args: { lintRunId: LintRunId; wikiId: WikiId }): Promise<void>;
  subscribe(lintRunId: LintRunId): AsyncIterable<LintEvent>;
}

export interface VerificationDeps {
  verifier: AnthropicVerifier;
  claims: ClaimReader;
  sourceText: SourceTextReader;
  runs: LintRunRepository;
  findings: LintFindingRepository;
  lintDispatcher: LintRunDispatcher;
  eventBus: EventBus;
  newId: () => string;
  now: () => Date;
}

// Runtime variant used inside the LintRunDO (and lintWiki tests). It adds an
// emitter for in-process events (LintEvent → DO tape + SSE) plus a
// concurrency cap for the per-Claim audit fan-out.
export interface LintRuntimeDeps extends VerificationDeps {
  emit(event: LintEvent): Promise<void>;
  concurrency: number;
}

// Re-export the shared use-case types so use-cases need only one import.
export type { ClaimId, LintFindingId, LintRunId, WikiId, WikiPageId };
export type CitationView = Citation;
