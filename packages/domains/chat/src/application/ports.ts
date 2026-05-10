import type {
  AnswerEvent,
  Conversation as ConvWire,
  Turn as TurnWire,
} from '@package/contracts/chat';
import type { AnswerProduced } from '@package/contracts/events';
import type {
  Citation,
  ConversationId,
  TurnId,
  UserId,
  WikiId,
  WikiPageId,
} from '@package/contracts/shared';
import type { Conversation } from '../domain/conversation.ts';
import type { Turn } from '../domain/turn.ts';

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
 */
export type RawAnswerSegment =
  | { kind: 'prose'; text: string }
  | { kind: 'citation'; citationId: string }
  | {
      kind: 'artifact';
      artifact: {
        kind:
          | 'ComparisonTable'
          | 'Timeline'
          | 'LineChart'
          | 'BarChart'
          | 'KeyMetric'
          | 'CodeBlock'
          | 'Quote'
          | 'Markdown';
        // Loose at this layer; the typed registry in @package/contracts/shared
        // re-validates props when we hand back a verified Artifact.
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

/**
 * Local cross-context event bus. The `chat` slice publishes `AnswerProduced`
 * after a Turn finishes; the `wiki` slice subscribes via the same interface.
 * A real implementation lives in `@package/shared-kernel/events` once that
 * primitive lands; until then each slice ships its own port + binding.
 */
export interface EventBus {
  publish(event: AnswerProduced): Promise<void>;
}

export interface ChatDeps {
  researcher: Researcher;
  synthesizer: Synthesizer;
  sourceHashes: SourceHashVerifier;
  wikiReader: WikiReader;
  conversations: ConversationRepository;
  turns: TurnRepository;
  dispatcher: ConversationDispatcher;
  eventBus: EventBus;
  newId: () => string;
  now: () => Date;
}
