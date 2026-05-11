import type {
  CompileRunId,
  FolderId,
  SourceId,
  WikiId,
  WikiPageId,
} from '@package/contracts/shared';
import type {
  CompileEvent,
  WikiPage as WikiPageWire,
  Wiki as WikiWire,
} from '@package/contracts/wiki';
import type { EventBus } from '@package/shared-kernel';
import type { z } from 'zod';
import type { Backlink } from '../domain/backlink.ts';
import type { CompileRun } from '../domain/compile-run.ts';
import type { WikiPage } from '../domain/wiki-page.ts';
import type { Wiki } from '../domain/wiki.ts';

// Wire-text payload for a Source pulled from the ingestion context's R2.
export interface ExtractedSourceText {
  sourceId: SourceId;
  filename: string;
  contentHash: string;
  text: string;
}

// Read-only view onto the ingestion context. Wiki never writes here.
export interface SourceReader {
  read(sourceId: SourceId): Promise<ExtractedSourceText | null>;
  list(folderId: FolderId): Promise<Array<{ sourceId: SourceId; filename: string }>>;
}

// LLM port. Implemented by `infrastructure/llm-client.ts` over the Vercel AI
// SDK + OpenRouter. Every agent goes through this single port.
export interface LlmClient {
  generateObject<TSchema extends z.ZodTypeAny>(args: {
    model: string;
    system: string;
    prompt: string;
    schema: TSchema;
    schemaName?: string;
    schemaDescription?: string;
    maxTokens?: number;
    temperature?: number;
  }): Promise<{
    result: z.infer<TSchema>;
    inputTokens: number;
    outputTokens: number;
  }>;
}

export interface WikiRepository {
  insert(wiki: Wiki): Promise<void>;
  update(wiki: Wiki): Promise<void>;
  findById(id: WikiId): Promise<Wiki | null>;
  findByFolderId(id: FolderId): Promise<Wiki | null>;
  list(args: { cursor?: string; limit: number }): Promise<{
    items: Wiki[];
    nextCursor?: string;
  }>;
  toWire(w: Wiki): WikiWire;
  /**
   * Cascade-delete this wiki and every row that hangs off it: citations
   * → claims → backlinks → wiki_pages → wikis. Returns the page ids the
   * caller should remove from R2 (this port doesn't own page bodies —
   * `WikiPageBodyStorage` does). Idempotent: deleting a wiki that no
   * longer exists returns `{ deletedPageIds: [] }` instead of erroring,
   * so a stale UI tab can't crash on a stale id.
   */
  cascadeDelete(wikiId: WikiId): Promise<{ deletedPageIds: WikiPageId[] }>;
}

export interface WikiPageRepository {
  insertMany(pages: WikiPage[]): Promise<void>;
  findById(id: WikiPageId): Promise<WikiPage | null>;
  /**
   * Delete page-body objects from blob storage for these ids. Used after
   * `WikiRepository.cascadeDelete` to clean up the R2 side (D1 cascade
   * removes the rows; this removes the markdown bodies). Individual
   * misses (already-gone keys) MUST NOT throw — implementations should
   * `Promise.allSettled` internally.
   */
  deleteBodies(pageIds: ReadonlyArray<WikiPageId>): Promise<void>;
  list(args: {
    wikiId: WikiId;
    subtype?: 'Concept' | 'Summary' | 'Answer' | 'Index';
    pageType?: string;
    cursor?: string;
    limit: number;
  }): Promise<{ items: WikiPage[]; nextCursor?: string }>;
  toWire(p: WikiPage): WikiPageWire;
}

export interface CompileRunRepository {
  insert(run: CompileRun): Promise<void>;
  update(run: CompileRun): Promise<void>;
  findById(id: CompileRunId): Promise<CompileRun | null>;
}

export interface CompileRunDispatcher {
  start(args: { compileRunId: CompileRunId; folderId: FolderId }): Promise<void>;
  subscribe(compileRunId: CompileRunId): AsyncIterable<CompileEvent>;
}

// Surfaces structural problems in the compiled wiki — claims with no
// citations, schema PageTypes with no pages, sources never cited.
// Implemented as a D1-backed adapter at the api boundary; the domain
// only knows the analyzer interface.
export interface GapAnalyzer {
  analyze(wikiId: WikiId): Promise<{
    pageTypeWithNoPages: ReadonlyArray<{ pageType: string; description: string }>;
    pagesWithNoClaims: ReadonlyArray<{
      pageId: string;
      title: string;
      pageType: string | null;
    }>;
    claimsWithNoCitations: ReadonlyArray<{
      pageId: string;
      pageTitle: string;
      claimId: string;
      claimText: string;
    }>;
    sourcesNeverCited: ReadonlyArray<{ sourceId: string; filename: string }>;
  }>;
}

// Read-side dependencies the oRPC handlers see.
export interface WikiDeps {
  llm: LlmClient;
  sources: SourceReader;
  wikis: WikiRepository;
  pages: WikiPageRepository;
  runs: CompileRunRepository;
  dispatcher: CompileRunDispatcher;
  gapAnalyzer: GapAnalyzer;
  eventBus: EventBus;
  newId: () => string;
  now: () => Date;
}

// Internal runtime deps used inside the CompileRunDO. Adds an emit() that
// fans CompileEvents out to subscribers + persists the tape.
export interface CompileRuntimeDeps extends WikiDeps {
  emit(event: CompileEvent): Promise<void>;
}

export type { Backlink };
