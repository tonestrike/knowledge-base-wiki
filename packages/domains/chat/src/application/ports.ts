import type {
  AnswerEvent,
  Conversation as ConvWire,
  Turn as TurnWire,
} from '@package/contracts/chat';
import type {
  ArtifactKind,
  Citation,
  ConversationId,
  TurnId,
  UserId,
  WikiId,
  WikiPageId,
} from '@package/contracts/shared';
import type { EventBus } from '@package/shared-kernel';
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

export interface WikiReader {
  searchPages(args: { wikiId: WikiId; query: string; limit: number }): Promise<WikiPageSummary[]>;
  getPage(id: WikiPageId): Promise<WikiPageSummary | null>;
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

export interface SynthesizerInput {
  question: string;
  findings: ReadonlyArray<{
    quoteText: string;
    citationIds: string[];
    citations: Citation[];
  }>;
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
  | { kind: 'proseDelta'; segmentIndex: number; textDelta: string };

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
}

export interface ResearcherOutput {
  pages: WikiPageSummary[];
  findings: Array<{
    wikiPageId: WikiPageId;
    quoteText: string;
    citationIds: string[];
    citations: Citation[];
  }>;
}

export interface Researcher {
  research(input: ResearcherInput): Promise<ResearcherOutput>;
}

/**
 * Async fan-out for `AnswerEvent`s. `start` kicks off a Turn run; `subscribe`
 * yields the live stream (and any tape replay so a late subscriber catches up).
 * In-process: the dispatcher itself drives the run. In production: a Cloudflare
 * Durable Object hosts the run and the dispatcher is a thin client.
 */
export interface ConversationDispatcher {
  start(args: {
    conversationId: ConversationId;
    turnId: TurnId;
    wikiId: WikiId;
    question: string;
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
}

/** Combined deps used at the oRPC handler boundary; kept for compatibility
 *  with the existing `ChatContext`. New use-cases should prefer the narrow
 *  per-purpose interfaces above. */
export interface ChatDeps extends ChatWriteDeps, ChatReadDeps, ChatRuntimeDeps {}
