import {
  type ChatContext,
  type ConversationRepository,
  type EventBus,
  type Researcher,
  type Synthesizer,
  type TurnRepository,
  type WikiReader,
  createInMemoryDispatcher,
  createMemorySourceHashVerifier,
} from '@domain/chat';
import type { Conversation as ConvWire, Turn as TurnWire } from '@package/contracts/chat';
import { userId } from '@package/contracts/shared';
import { systemClock } from '@package/shared-kernel';

/**
 * Default chat-context bindings for the api. Slice 2.C ships in-memory
 * repos, a stub Researcher / Synthesizer, and an in-process dispatcher so the
 * api typechecks and runs end-to-end against contract mocks. Phase 3 swaps
 * these for D1 repos, the Vercel-AI-SDK Researcher / Synthesizer, and the
 * Cloudflare Durable Object dispatcher (see `@domain/chat/infrastructure/*`).
 *
 * The single-user demo currentUserId is hard-coded; multi-user OAuth lands in
 * Phase 4.
 */

type Conv = Parameters<ConversationRepository['insert']>[0];
type Trn = Parameters<TurnRepository['insert']>[0];

const inMemoryConversations = (): ConversationRepository => {
  const store = new Map<string, Conv>();
  return {
    async insert(c) {
      store.set(c.id, c);
    },
    async findById(id) {
      return store.get(id) ?? null;
    },
    async list({ wikiId, userId: uid, cursor, limit }) {
      const all = [...store.values()].filter((c) => {
        if (wikiId && c.wikiId !== wikiId) return false;
        if (uid && c.userId !== uid) return false;
        return true;
      });
      all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const start = cursor ? Number.parseInt(cursor, 10) : 0;
      const items = all.slice(start, start + limit);
      const nextCursor = start + limit < all.length ? String(start + limit) : undefined;
      return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
    },
    toWire(c): ConvWire {
      return {
        id: c.id,
        wikiId: c.wikiId,
        userId: c.userId,
        ...(c.title !== undefined ? { title: c.title } : {}),
        createdAt: c.createdAt,
      };
    },
  };
};

const inMemoryTurns = (): TurnRepository => {
  const store = new Map<string, Trn>();
  return {
    async insert(t) {
      store.set(t.id, t);
    },
    async update(t) {
      store.set(t.id, t);
    },
    async findById(id) {
      return store.get(id) ?? null;
    },
    async list({ conversationId, cursor, limit }) {
      const all = [...store.values()]
        .filter((t) => t.conversationId === conversationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const start = cursor ? Number.parseInt(cursor, 10) : 0;
      const items = all.slice(start, start + limit);
      const nextCursor = start + limit < all.length ? String(start + limit) : undefined;
      return { items, ...(nextCursor !== undefined ? { nextCursor } : {}) };
    },
    toWire(t): TurnWire {
      return {
        id: t.id,
        conversationId: t.conversationId,
        question: t.question,
        answer: [...t.answer],
        createdAt: t.createdAt,
        ...(t.finishedAt !== undefined ? { finishedAt: t.finishedAt } : {}),
      };
    },
  };
};

const stubResearcher: Researcher = {
  async research() {
    return { pages: [], findings: [] };
  },
};

const emptyAsyncIterable = <T>(): AsyncIterable<T> => ({
  [Symbol.asyncIterator]: () => ({
    async next(): Promise<IteratorResult<T>> {
      return { value: undefined as unknown as T, done: true };
    },
  }),
});

const stubSynthesizer: Synthesizer = {
  stream() {
    // empty stream → use-case emits AnswerStarted then AnswerFinished.
    return emptyAsyncIterable();
  },
};

const stubWikiReader: WikiReader = {
  async searchPages() {
    return [];
  },
  async getPage() {
    return null;
  },
};

const consoleEventBus: EventBus = {
  async publish(event) {
    console.info('[domain-event]', event.name, event.payload);
  },
};

export interface BuildChatContextOptions {
  /** Default user id used for the single-user demo. */
  currentUserId?: string;
}

export const buildChatContext = (opts: BuildChatContextOptions = {}): ChatContext => {
  const conversations = inMemoryConversations();
  const turns = inMemoryTurns();
  const sourceHashes = createMemorySourceHashVerifier({
    async readSourceText() {
      return null;
    },
    async sha256Hex(s) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      return `sha256:${hex}`;
    },
  });
  const dispatcher = createInMemoryDispatcher({
    researcher: stubResearcher,
    synthesizer: stubSynthesizer,
    sourceHashes,
    conversations,
    turns,
    eventBus: consoleEventBus,
    wikiReader: stubWikiReader,
    now: () => new Date(),
  });

  return {
    clock: systemClock,
    researcher: stubResearcher,
    synthesizer: stubSynthesizer,
    sourceHashes,
    conversations,
    turns,
    dispatcher,
    eventBus: consoleEventBus,
    wikiReader: stubWikiReader,
    newId: () => crypto.randomUUID(),
    now: () => new Date(),
    currentUserId: userId(opts.currentUserId ?? '99999999-2222-4333-8444-555555555555'),
  };
};
