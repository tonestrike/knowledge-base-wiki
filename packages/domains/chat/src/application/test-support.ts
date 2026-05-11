import type { Conversation as ConvWire, Turn as TurnWire } from '@package/contracts/chat';
import type {
  Citation,
  ConversationId,
  TurnId,
  UserId,
  WikiId,
  WikiPageId,
} from '@package/contracts/shared';
import { conversationId, turnId } from '@package/contracts/shared';
import { InMemoryEventBus } from '@package/shared-kernel';
import type { Conversation } from '../domain/conversation.ts';
import type { Turn } from '../domain/turn.ts';
import type {
  ChatDeps,
  ConversationDispatcher,
  ConversationRepository,
  Researcher,
  ResearcherOutput,
  Synthesizer,
  SynthesizerEvent,
  TurnRepository,
  WikiPageSummary,
  WikiReader,
} from './ports.ts';

export type DispatchedAsk = {
  conversationId: ConversationId;
  turnId: TurnId;
  wikiId: WikiId;
  question: string;
};

export interface FakeChatDeps extends ChatDeps {
  _dispatched: DispatchedAsk[];
  _published: Array<unknown>;
}

export interface MakeFakeOptions {
  ids?: string[];
  researcherOutput?: ResearcherOutput;
  synthesizerEvents?: SynthesizerEvent[];
  wikiPages?: WikiPageSummary[];
}

const inMemoryConversations = (): ConversationRepository => {
  const store = new Map<string, Conversation>();
  return {
    async insert(c) {
      store.set(c.id, c);
    },
    async findById(id) {
      return store.get(id) ?? null;
    },
    async list({ wikiId, userId, cursor, limit }) {
      const all = [...store.values()].filter((c) => {
        if (wikiId && c.wikiId !== wikiId) return false;
        if (userId && c.userId !== userId) return false;
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
  const store = new Map<string, Turn>();
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

const noopResearcher: Researcher = {
  async research() {
    return { pages: [], findings: [] };
  },
};

const noopSynthesizer: Synthesizer = {
  async *stream() {
    /* no events */
  },
};

const noopWikiReader: WikiReader = {
  async searchPages() {
    return [];
  },
  async listSamplePages() {
    return [];
  },
  async getPage() {
    return null;
  },
  async searchSources() {
    return [];
  },
};

export const makeFakeChatDeps = (opts: MakeFakeOptions = {}): FakeChatDeps => {
  const queue = [...(opts.ids ?? [])];
  const dispatched: DispatchedAsk[] = [];
  const published: unknown[] = [];

  const dispatcher: ConversationDispatcher = {
    async start(args) {
      dispatched.push(args);
    },
    async *subscribe() {
      /* no events */
    },
  };

  const fixedResearcherOutput = opts.researcherOutput;
  const researcher: Researcher = fixedResearcherOutput
    ? {
        async research() {
          return fixedResearcherOutput;
        },
      }
    : noopResearcher;

  const fixedSynthesizerEvents = opts.synthesizerEvents;
  const synthesizer: Synthesizer = fixedSynthesizerEvents
    ? {
        async *stream() {
          for (const e of fixedSynthesizerEvents) yield e;
        },
      }
    : noopSynthesizer;

  const fixedWikiPages = opts.wikiPages;
  const wikiReader: WikiReader = fixedWikiPages
    ? {
        async searchPages() {
          return fixedWikiPages;
        },
        async listSamplePages() {
          return fixedWikiPages;
        },
        async getPage(id) {
          return fixedWikiPages.find((p) => p.id === id) ?? null;
        },
        async searchSources() {
          return [];
        },
      }
    : noopWikiReader;

  // Use the canonical InMemoryEventBus (TD-15). We instrument it by wrapping
  // `publish` so tests can assert what was emitted. `subscribe` works as
  // usual for in-process cross-context wiring tests.
  const bus = new InMemoryEventBus();
  const originalPublish = bus.publish.bind(bus);
  bus.publish = async (event) => {
    published.push(event);
    await originalPublish(event);
  };

  return {
    researcher,
    synthesizer,
    sourceHashes: {
      async verify() {
        return { ok: true };
      },
    },
    wikiReader,
    conversations: inMemoryConversations(),
    turns: inMemoryTurns(),
    dispatcher,
    eventBus: bus,
    newId: () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('makeFakeChatDeps ran out of ids');
      return next;
    },
    now: () => new Date('2026-05-09T12:00:00.000Z'),
    _dispatched: dispatched,
    _published: published,
  };
};

export const fakeCitation = (id: string, sourceUuid: string): Citation => ({
  id: id as unknown as Citation['id'],
  label: 'fixture',
  span: {
    sourceId: sourceUuid as unknown as Citation['span']['sourceId'],
    byteRange: { start: 0, end: 5 },
    contentHash: 'sha256:fixture' as unknown as Citation['span']['contentHash'],
  },
});

export const fakePage = (overrides: Partial<WikiPageSummary> = {}): WikiPageSummary => ({
  id: 'dddddddd-1111-4222-8333-444444444444' as unknown as WikiPageId,
  wikiId: '44444444-2222-4333-8444-555555555555' as unknown as WikiId,
  title: 'Q3 NRR',
  pageType: 'Metric',
  body: 'NRR was 110%.',
  citations: [],
  ...overrides,
});

export const newConversationId = (s: string): ConversationId => conversationId(s);
export const newTurnId = (s: string): TurnId => turnId(s);
export const newUserId = (s: string): UserId => s as unknown as UserId;
