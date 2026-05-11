import type {
  AnswerEvent,
  Conversation as ConvWire,
  Turn as TurnWire,
} from '@package/contracts/chat';
import type {
  ArtifactKind,
  Citation,
  ContentHash,
  ConversationId,
  SourceId,
  TurnId,
  UserId,
  WikiId,
  WikiPageId,
} from '@package/contracts/shared';
import type { EventBus, Tracer } from '@package/shared-kernel';
import type { Conversation } from '../domain/conversation.ts';
import type { Turn } from '../domain/turn.ts';

// Re-export for adapters that already import EventBus from chat. The
// canonical home is `@package/shared-kernel`. We re-export here so call
// sites keep working through the chat barrel; the chat package itself
// owns no EventBus implementation.
//
// TD-15: deleting the local interface in favor of the shared-kernel one.
export type { EventBus } from '@package/shared-kernel';

export interface WikiPageSummary {
  id: WikiPageId;
  wikiId: WikiId;
  title: string;
  pageType?: string;
  body: string;
  citations: Citation[];
}

/**
 * A hit from `searchSources` — the agent's fallback when page-title /
 * page-body search misses content that's clearly present in the underlying
 * `Source` text (PDFs, markdown, transcripts). Each hit carries:
 *
 *   - an `excerpt` showing why it matched (used in agent reasoning),
 *   - the precise `byteRange` of the matched region in the source,
 *   - `citingPages` — wiki pages already grounded on this source so the
 *     agent can drill into them via `readWikiPage` and bring real
 *     `Citation`s into the synth's working set.
 *
 * The agent does NOT mint new citations from raw source matches — only
 * pages with existing claims/citations feed the synth, so the fabrication
 * tripwire stays intact. This tool's job is discovery: get the agent
 * pointed at the right pages when keyword overlap on page titles/bodies
 * misses the user's phrasing.
 */
export interface SourceSearchHit {
  sourceId: SourceId;
  excerpt: string;
  byteRange: { start: number; end: number };
  contentHash: ContentHash;
  citingPages: Array<{ pageId: WikiPageId; title: string; pageType?: string }>;
}

/**
 * Lightweight wiki metadata the chat agent needs to navigate by
 * taxonomy: the list of PageType names (the wiki's sections), the
 * folder name, and the perspective the wiki was compiled under (if
 * any). Lets the agent reason about "the user asked about business
 * ideas → that maps to the Opportunity PageType in this wiki" without
 * keyword-guessing.
 */
export interface WikiMeta {
  wikiId: WikiId;
  pageTypes: ReadonlyArray<{ name: string; description: string }>;
  perspective?: string;
  folderName?: string;
}

export interface WikiReader {
  searchPages(args: { wikiId: WikiId; query: string; limit: number }): Promise<WikiPageSummary[]>;
  /**
   * Returns the first `limit` pages from the wiki regardless of any query.
   * Used as a fallback when `searchPages` returns empty so the chat can
   * surface a "here's what this wiki covers" suggestion list instead of
   * a dead-end "no results" message.
   */
  listSamplePages(args: { wikiId: WikiId; limit: number }): Promise<WikiPageSummary[]>;
  getPage(id: WikiPageId): Promise<WikiPageSummary | null>;
  /**
   * Token-overlap search across the underlying `Source` text for every
   * source cited by any page in this wiki. The agent uses this when page
   * search misses content the user's phrasing should plausibly hit — the
   * extracted PDF/markdown body of a paper often contains key tokens the
   * compiled page title and body don't repeat. Returns the top `limit`
   * matches each with citing-page pointers so the agent can drill back
   * into real wiki pages (and keep the citation chain grounded).
   */
  searchSources(args: {
    wikiId: WikiId;
    query: string;
    limit: number;
  }): Promise<SourceSearchHit[]>;
  /**
   * Enumerate Concept-subtype pages by PageType. Used by the agent when
   * the user's question maps to a known section ("business ideas" → the
   * Opportunity PageType in a business-opportunities wiki). Index pages
   * are excluded — they're tables of contents, not content.
   */
  listPagesByType(args: {
    wikiId: WikiId;
    pageType: string;
    limit: number;
  }): Promise<WikiPageSummary[]>;
  /**
   * Fetch the wiki's taxonomy + perspective so the agent's system
   * prompt can be tailored per-wiki. Returns null if the wiki id is
   * unknown.
   */
  getWikiMeta(wikiId: WikiId): Promise<WikiMeta | null>;
}

/** Distinguished error for citation tripwire violations (SF-1). The use-case
 *  throws this so the dispatcher can tell a fabricated-citation tripwire
 *  apart from an infrastructure failure (network, db, model timeout). */
export class CitationTripwireError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CitationTripwireError';
  }
}

export interface SourceHashVerifier {
  verify(citation: Citation): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface ConversationRepository {
  insert(c: Conversation): Promise<void>;
  findById(id: ConversationId): Promise<Conversation | null>;
  list(args: {
    wikiId?: WikiId;
    userId?: UserId;
    cursor?: string;
    limit: number;
  }): Promise<{ items: Conversation[]; nextCursor?: string }>;
  toWire(c: Conversation): ConvWire;
}

export interface TurnRepository {
  insert(t: Turn): Promise<void>;
  update(t: Turn): Promise<void>;
  findById(id: TurnId): Promise<Turn | null>;
  list(args: {
    conversationId: ConversationId;
    cursor?: string;
    limit: number;
  }): Promise<{ items: Turn[]; nextCursor?: string }>;
  toWire(t: Turn): TurnWire;
}

/**
 * Prior turn rendered into the form the Synthesizer sees: each turn is one
 * user `question` paired with the assistant's prose response (citation
 * markers and artifact tool calls flattened back into a single plain-text
 * answer). The Synthesizer threads these through as `user`/`assistant`
 * messages before the live question so pronouns and topic continuations
 * resolve. Bounded short-context only — the Researcher already supplies the
 * grounded findings for the *current* question.
 */
export interface PriorTurn {
  question: string;
  answerText: string;
}

export interface SynthesizerInput {
  question: string;
  findings: ReadonlyArray<{
    quoteText: string;
    citationIds: string[];
    citations: Citation[];
  }>;
  /**
   * Optional chronological transcript of earlier turns in the same
   * Conversation, oldest first. Bounded by the use-case (most recent N
   * turns) to keep the prompt under control.
   */
  history?: ReadonlyArray<PriorTurn>;
  /**
   * Optional wiki-level context surfaced into the synth prompt so the
   * model knows the perspective + section vocabulary the findings were
   * shaped under. Prevents the "doesn't cover that" hallucination when
   * the user's question vocabulary doesn't match the page bodies'
   * source-document vocabulary.
   */
  wikiContext?: {
    perspective?: string;
    pageTypes?: ReadonlyArray<string>;
    folderName?: string;
  };
}

/**
 * A raw segment as emitted by the model. Citations are referenced by id only;
 * the use-case resolves them against the input findings and runs the
 * SourceHashVerifier before emitting any `AnswerEvent` carrying a `Citation`.
 *
 * `kind` reuses the typed `ArtifactKind` enum (TD-14) so the synthesizer
 * port stays in sync with the closed Artifact registry in the contract layer.
 * `props` stays `unknown` deliberately: per-kind shapes are re-validated
 * against the typed `Artifact` registry inside the use-case.
 */
export type RawAnswerSegment =
  | { kind: 'prose'; text: string }
  | { kind: 'citation'; citationId: string }
  | {
      kind: 'artifact';
      artifact: {
        kind: ArtifactKind;
        props: unknown;
        citationIds: string[];
      };
    };

export type SynthesizerEvent =
  | { kind: 'segment'; index: number; segment: RawAnswerSegment }
  | { kind: 'proseDelta'; segmentIndex: number; textDelta: string }
  // Live train-of-thought. The adapter emits these from the model's
  // `tool-input-start` / `tool-input-delta` / `tool-input-end` parts so
  // the UI can show "Drafting ComparisonTable…", "Adding columns: model,
  // training data, …", "Polishing…" while the silent tool-input bytes
  // accumulate. The use-case forwards them as `AnswerThinking` events.
  | { kind: 'thinking'; message: string };

export interface Synthesizer {
  /**
   * Streams raw segments for one Turn. The use-case verifies citation hashes
   * before any segment is forwarded as an `AnswerEvent`. Implementations bridge
   * Vercel AI SDK `streamObject` (or any structured-output backend) into this
   * shape; they do not know about hash verification or domain events.
   */
  stream(input: SynthesizerInput): AsyncIterable<SynthesizerEvent>;
}

export interface ResearcherInput {
  wikiId: WikiId;
  question: string;
  /**
   * Optional progress callback fired as findings stream in from the model.
   * The dispatcher uses this to emit `ResearchProgress` events to the SSE
   * tape so the UI surfaces real per-finding progress instead of a static
   * spinner.
   */
  onPartial?: (partial: { findings: number }) => void;
  /**
   * Optional callback fired the moment a wiki page is pulled into the
   * working set. The agentic researcher iterates — searching, drilling
   * into hits, searching again with refined queries — and a live "Reading
   * X" tick per page is what makes the loop visible. The dispatcher wires
   * this to emit one `WikiPageRetrieved` event per page as the agent
   * surfaces it, instead of one batch at the end of research. The same
   * page may appear from multiple tool calls; the callback dedupes is the
   * caller's job (the dispatcher tracks emitted ids).
   */
  onPageVisited?: (page: WikiPageSummary) => void;
}

export interface ResearcherOutput {
  pages: WikiPageSummary[];
  findings: Array<{
    wikiPageId: WikiPageId;
    quoteText: string;
    citationIds: string[];
    citations: Citation[];
  }>;
  /**
   * Populated only when the question matched no pages. Carries a sample of
   * what the wiki contains so the synthesizer can guide the user to a
   * useful follow-up question instead of saying "nothing found".
   */
  suggestionPages?: WikiPageSummary[];
}

export interface Researcher {
  research(input: ResearcherInput): Promise<ResearcherOutput>;
}

/**
 * Anchor a background promise to the current request's lifetime. On Cloudflare
 * Workers this maps to `ExecutionContext.waitUntil`, which keeps the isolate
 * alive (and lets async I/O continue) after the response has been sent. In
 * tests / non-Workers runtimes it can be a no-op.
 *
 * The chat dispatcher needs this because `chat.ask` returns the `turnId`
 * immediately and the actual research + synthesis runs asynchronously; the
 * SSE `streamAnswer` request that consumes the resulting events is a separate
 * HTTP call. Without `waitUntil`, workerd cancels new I/O for the orphaned
 * promise the moment `ask` responds, leaving the run frozen mid-`await`.
 */
export type WaitUntil = (p: Promise<unknown>) => void;

/**
 * Async fan-out for `AnswerEvent`s. `start` kicks off a Turn run; `subscribe`
 * yields the live stream (and any tape replay so a late subscriber catches up).
 * In-process: the dispatcher itself drives the run. In production: a Cloudflare
 * Durable Object hosts the run and the dispatcher is a thin client.
 *
 * `start` accepts an optional `waitUntil` so the caller can keep the
 * fire-and-forget `run` promise alive past the originating request's response.
 */
export interface ConversationDispatcher {
  start(args: {
    conversationId: ConversationId;
    turnId: TurnId;
    wikiId: WikiId;
    question: string;
    waitUntil?: WaitUntil;
  }): Promise<void>;
  subscribe(args: {
    conversationId: ConversationId;
    turnId: TurnId;
  }): AsyncIterable<AnswerEvent>;
}

// Per-use-case dependency slices (TD-17). The dispatcher's `ChatRuntimeDeps`
// is the wide one; oRPC handlers (`ChatReadDeps`, `ChatWriteDeps`) only see
// what they need. `ChatDeps` stays as the union for back-compat with the
// interface context type — but new code should pick the narrow alias.

/** Dependencies for the `open` / `ask` write-paths. */
export interface ChatWriteDeps {
  conversations: ConversationRepository;
  turns: TurnRepository;
  dispatcher: ConversationDispatcher;
  newId: () => string;
  now: () => Date;
  /** Per-request keepalive; supplied by the Hono middleware in production. */
  waitUntil?: WaitUntil;
}

/** Dependencies for the read endpoints (`get*`, `list*`). */
export interface ChatReadDeps {
  conversations: ConversationRepository;
  turns: TurnRepository;
}

/** Dependencies for the in-process dispatcher and Researcher/Synthesizer
 *  use-cases. Owns the heavy adapters; never wired into the oRPC handler
 *  context directly except as part of the wider {@link ChatDeps}. */
export interface ChatRuntimeDeps {
  researcher: Researcher;
  synthesizer: Synthesizer;
  sourceHashes: SourceHashVerifier;
  wikiReader: WikiReader;
  conversations: ConversationRepository;
  turns: TurnRepository;
  eventBus: EventBus;
  now: () => Date;
  /** Observability port. Optional — `noOpTracer` is the safe default. */
  tracer?: Tracer;
}

/** Combined deps used at the oRPC handler boundary; kept for compatibility
 *  with the existing `ChatContext`. New use-cases should prefer the narrow
 *  per-purpose interfaces above. */
export interface ChatDeps extends ChatWriteDeps, ChatReadDeps, ChatRuntimeDeps {}
