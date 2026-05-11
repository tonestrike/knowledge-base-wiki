import type { AnswerEvent } from '@package/contracts/chat';
import { AnswerEvent as AnswerEventSchema } from '@package/contracts/chat';
import type { ChatTransport, UIMessageChunk } from 'ai';
import type { TenexUIMessage, TenexUIMessageDataParts } from './chat-message-types.ts';
import { client } from './orpc.ts';

/**
 * Bridge our oRPC `chat.streamAnswer` SSE protocol into AI SDK's
 * `ChatTransport<UIMessage>` so `useChat` (and AI Elements components
 * built on it) can drive the dock without ever knowing about
 * AnswerEvents.
 *
 * Two-step submission (matches the existing dispatcher contract):
 *   1. POST `chat.ask` → server allocates a `turnId` and starts the run.
 *   2. POST `chat.streamAnswer({ turnId })` → SSE of `AnswerEvent`s.
 *
 * Translation table — AnswerEvent → UIMessageChunk:
 *
 *   AnswerStarted          → start, start-step, data-turn-meta
 *   ResearchStarted        → reasoning-start (id: "phase-research")
 *   WikiPageRetrieved      → data-wiki-page-retrieved
 *                            + reasoning-delta into "phase-research"
 *   ResearchCompleted      → reasoning-delta + reasoning-end
 *   SynthesisStarted       → reasoning-start (id: "phase-synth")
 *                            then immediate reasoning-end so the chip
 *                            collapses cleanly when the answer body
 *                            takes over
 *   AnswerProseDelta       → text-start (first delta for this index) +
 *                            text-delta (id: "seg-${segmentIndex}")
 *   AnswerSegment(prose)   → text-end (or full text-start/delta/end if
 *                            no deltas were seen for this index)
 *   AnswerSegment(citation)→ data-citation
 *   AnswerSegment(artifact)→ data-artifact
 *   AnswerFinished         → finish-step, finish
 *   AnswerFailed           → error
 *
 * `reconnectToStream` returns null — we don't currently support resume
 * across page reloads (the D1 turn replay handles re-mount and is the
 * canonical persistence path; mid-stream resume is a separate slice).
 */

export interface CreateTenexChatTransportOptions {
  /** The Conversation aggregate the chat is attached to. */
  conversationId: string;
}

export const createTenexChatTransport = (
  opts: CreateTenexChatTransportOptions,
): ChatTransport<TenexUIMessage> => {
  return {
    async sendMessages({ messages, abortSignal }) {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (!lastUser) {
        throw new Error('chat-transport: sendMessages called without a user message');
      }
      const question = extractText(lastUser);
      if (!question) {
        throw new Error('chat-transport: latest user message had no text content');
      }

      const { turnId } = await client.chat.ask({
        conversationId: opts.conversationId,
        question,
      });

      return openAnswerStream(turnId, abortSignal);
    },

    async reconnectToStream() {
      return null;
    },
  };
};

const extractText = (m: TenexUIMessage): string => {
  let out = '';
  for (const p of m.parts) {
    if (p.type === 'text') out += p.text;
  }
  return out.trim();
};

/**
 * Open the SSE for `chat/streamAnswer`, parse each frame as an
 * `AnswerEvent`, and translate to UIMessageChunks via {@link translate}.
 *
 * We hand-roll the fetch + SSE parse rather than going through
 * `useEventStream` because that hook is React-bound and the transport
 * needs to produce a plain ReadableStream. The frame format matches
 * oRPC's eventIterator wire shape: each SSE `data:` line is the JSON
 * `{ json: <AnswerEvent> }` envelope.
 */
const openAnswerStream = async (
  turnId: string,
  abortSignal: AbortSignal | undefined,
): Promise<ReadableStream<UIMessageChunk>> => {
  const response = await fetch('/rpc/chat/streamAnswer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ json: { turnId } }),
    signal: abortSignal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`chat-transport: streamAnswer returned ${response.status}`);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffered = '';
  const state = createTranslationState(turnId);

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            // Drain any unflushed translations (text-end for an
            // unfinalized prose part, etc.) so AI Elements doesn't
            // render a perpetually-streaming bubble.
            for (const chunk of state.flushOnClose()) controller.enqueue(chunk);
            controller.close();
            return;
          }
          buffered += decoder.decode(value, { stream: true });
          const frames = drainFrames(buffered);
          buffered = frames.remainder;
          for (const raw of frames.events) {
            const evt = parseFrame(raw);
            if (!evt) continue;
            for (const chunk of translate(evt, state)) controller.enqueue(chunk);
          }
          if (frames.events.length > 0) return; // back-pressure
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
};

interface FrameDrainResult {
  events: string[];
  remainder: string;
}

const drainFrames = (buffer: string): FrameDrainResult => {
  // Per the SSE spec, frames are separated by a blank line ("\n\n").
  // Within a frame, only `data:` lines carry payload; everything else
  // (event:, id:, retry:, comments) is dropped.
  const events: string[] = [];
  let cursor = 0;
  while (true) {
    const sep = buffer.indexOf('\n\n', cursor);
    if (sep === -1) break;
    const frame = buffer.slice(cursor, sep);
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data.length > 0) events.push(data);
    cursor = sep + 2;
  }
  return { events, remainder: buffer.slice(cursor) };
};

const parseFrame = (raw: string): AnswerEvent | null => {
  try {
    const json = JSON.parse(raw) as unknown;
    const payload =
      typeof json === 'object' && json !== null && 'json' in json
        ? (json as { json: unknown }).json
        : json;
    return AnswerEventSchema.parse(payload);
  } catch {
    return null;
  }
};

interface TranslationState {
  turnId: string;
  /** Per-segment text-part state so we can emit text-start at most once. */
  textStarted: Set<number>;
  textEnded: Set<number>;
  /** Per-segment accumulated text (used only to fall back when AnswerSegment
   *  arrives without prior deltas — in that case we synthesise the deltas). */
  proseSeen: Map<number, string>;
  /** Reasoning blocks are scoped per "phase" so AI Elements groups them. */
  reasoningStarted: Set<string>;
  reasoningEnded: Set<string>;
  /** Set once we've emitted `start` so we don't double-fire on AnswerStarted. */
  messageStarted: boolean;
  /** Set once AnswerFailed/AnswerFinished closes the message. */
  messageFinished: boolean;
  /**
   * Drain any trailing chunks needed to leave the message in a valid
   * state when the SSE closes without a terminal event (network drop,
   * server crash mid-stream). Idempotent.
   */
  flushOnClose: () => Chunk[];
}

const createTranslationState = (turnId: string): TranslationState => {
  const state: TranslationState = {
    turnId,
    textStarted: new Set(),
    textEnded: new Set(),
    proseSeen: new Map(),
    reasoningStarted: new Set(),
    reasoningEnded: new Set(),
    messageStarted: false,
    messageFinished: false,
    flushOnClose: () => [],
  };
  state.flushOnClose = () => {
    if (state.messageFinished) return [];
    state.messageFinished = true;
    return [
      ...closeOpenParts(state),
      { type: 'error', errorText: 'Stream closed before AnswerFinished' },
      { type: 'finish-step' },
      { type: 'finish' },
    ];
  };
  return state;
};

const segId = (i: number): string => `seg-${i}`;
const reasonId = (phase: string): string => `phase-${phase}`;

type Chunk = UIMessageChunk<unknown, TenexUIMessageDataParts>;

const startReasoning = (state: TranslationState, phase: string): Chunk[] => {
  if (state.reasoningStarted.has(phase)) return [];
  state.reasoningStarted.add(phase);
  return [{ type: 'reasoning-start', id: reasonId(phase) }];
};

const endReasoning = (state: TranslationState, phase: string): Chunk[] => {
  if (!state.reasoningStarted.has(phase) || state.reasoningEnded.has(phase)) return [];
  state.reasoningEnded.add(phase);
  return [{ type: 'reasoning-end', id: reasonId(phase) }];
};

const ensureTextStart = (state: TranslationState, segmentIndex: number): Chunk[] => {
  if (state.textStarted.has(segmentIndex)) return [];
  state.textStarted.add(segmentIndex);
  return [{ type: 'text-start', id: segId(segmentIndex) }];
};

const ensureTextEnd = (state: TranslationState, segmentIndex: number): Chunk[] => {
  if (!state.textStarted.has(segmentIndex) || state.textEnded.has(segmentIndex)) return [];
  state.textEnded.add(segmentIndex);
  return [{ type: 'text-end', id: segId(segmentIndex) }];
};

const translate = (e: AnswerEvent, state: TranslationState): Chunk[] => {
  switch (e.kind) {
    case 'AnswerStarted': {
      if (state.messageStarted) return [];
      state.messageStarted = true;
      return [
        { type: 'start' },
        { type: 'start-step' },
        { type: 'data-turn-meta', data: { turnId: e.turnId }, transient: true },
      ];
    }

    case 'ResearchStarted': {
      // ResearchStarted.model carries the wired Researcher implementation
      // — "agent-loop · …" when the agentic tool-loop is on, "wiki-search"
      // when the direct fast-path is wired (no model). The bubble names
      // which one is running so the user can tell from the trace whether
      // the agent is iterating or doing a one-shot D1 lookup.
      const opener = e.model.startsWith('agent-loop')
        ? 'Agent searching the wiki — iterating queries and reading promising pages…\n'
        : 'Searching the compiled wiki for relevant pages…\n';
      return startReasoning(state, 'research').concat({
        type: 'reasoning-delta',
        id: reasonId('research'),
        delta: opener,
      });
    }

    case 'WikiPageRetrieved': {
      const typeLabel = e.pageType ? ` · ${e.pageType}` : '';
      const line = `Reading ${e.title}${typeLabel} · ${e.citationCount} citation${
        e.citationCount === 1 ? '' : 's'
      }\n`;
      return [
        ...startReasoning(state, 'research'),
        { type: 'reasoning-delta', id: reasonId('research'), delta: line },
        {
          type: 'data-wiki-page-retrieved',
          data: {
            wikiPageId: e.wikiPageId,
            title: e.title,
            ...(e.pageType !== undefined ? { pageType: e.pageType } : {}),
            citationCount: e.citationCount,
          },
        },
      ];
    }

    case 'ResearchProgress':
      return [];

    case 'ResearchCompleted': {
      const line = `Found ${e.candidatePageCount} relevant page${
        e.candidatePageCount === 1 ? '' : 's'
      }, grounding ${e.findingCount} finding${e.findingCount === 1 ? '' : 's'}.\n`;
      return [
        ...startReasoning(state, 'research'),
        { type: 'reasoning-delta', id: reasonId('research'), delta: line },
        ...endReasoning(state, 'research'),
      ];
    }

    case 'SynthesisStarted': {
      // Keep the synth reasoning bubble OPEN until the first answer
      // chunk arrives — AI Elements' Reasoning component shows a
      // shimmer animation while a reasoning stream is open, so the
      // user sees something alive during the (often 5-15s) gap
      // between SynthesisStarted and the first AnswerProseDelta.
      // The bubble is closed lazily in the AnswerProseDelta /
      // AnswerSegment / AnswerFinished branches via `closeSynth`.
      const line = `Composing answer with ${friendlyModel(e.model)}…\n`;
      return [
        ...startReasoning(state, 'synth'),
        { type: 'reasoning-delta', id: reasonId('synth'), delta: line },
      ];
    }

    case 'AnswerProseDelta': {
      const start = ensureTextStart(state, e.segmentIndex);
      state.proseSeen.set(
        e.segmentIndex,
        (state.proseSeen.get(e.segmentIndex) ?? '') + e.textDelta,
      );
      return [
        ...endReasoning(state, 'synth'),
        ...start,
        { type: 'text-delta', id: segId(e.segmentIndex), delta: e.textDelta },
      ];
    }

    case 'AnswerSegment': {
      const seg = e.segment;
      if (seg.kind === 'prose') {
        // If no deltas were emitted for this index (e.g. legacy synthesizer
        // path that doesn't stream), synthesise one delta carrying the
        // whole text so the rendered part still has content.
        const seen = state.proseSeen.get(e.index) ?? '';
        const out: Chunk[] = [...ensureTextStart(state, e.index)];
        if (seen.length === 0) {
          out.push({ type: 'text-delta', id: segId(e.index), delta: seg.text });
          state.proseSeen.set(e.index, seg.text);
        }
        out.push(...ensureTextEnd(state, e.index));
        return out;
      }
      if (seg.kind === 'citation') {
        return [{ type: 'data-citation', id: `cit-${seg.citation.id}`, data: seg.citation }];
      }
      // artifact — carry the full Artifact (kind+props+citations) so the
      // renderer can show citation chips alongside the artifact body
      // without cross-part lookups.
      return [{ type: 'data-artifact', id: `art-${e.index}`, data: seg.artifact }];
    }

    case 'AnswerFailed': {
      state.messageFinished = true;
      return [
        ...closeOpenParts(state),
        { type: 'error', errorText: e.message },
        { type: 'finish-step' },
        { type: 'finish' },
      ];
    }

    case 'AnswerFinished': {
      state.messageFinished = true;
      return [...closeOpenParts(state), { type: 'finish-step' }, { type: 'finish' }];
    }

    default:
      return [];
  }
};

const closeOpenParts = (state: TranslationState): Chunk[] => {
  const out: Chunk[] = [];
  for (const idx of state.textStarted) {
    if (!state.textEnded.has(idx)) {
      state.textEnded.add(idx);
      out.push({ type: 'text-end', id: segId(idx) });
    }
  }
  for (const phase of state.reasoningStarted) {
    if (!state.reasoningEnded.has(phase)) {
      state.reasoningEnded.add(phase);
      out.push({ type: 'reasoning-end', id: reasonId(phase) });
    }
  }
  return out;
};

const friendlyModel = (raw: string): string => {
  const slash = raw.indexOf('/');
  return slash >= 0 ? raw.slice(slash + 1) : raw;
};

/**
 * Test hook — exposes a fan-out function over the translation state so
 * tests can drive the protocol without setting up a real fetch + SSE.
 * Not part of the public surface; do not import from app code.
 */
export const __test__translateForTest = (
  turnIdValue: string,
): { (e: AnswerEvent): Chunk[]; flush: () => Chunk[] } => {
  const state = createTranslationState(turnIdValue);
  const fn = ((e: AnswerEvent) => translate(e, state)) as {
    (e: AnswerEvent): Chunk[];
    flush: () => Chunk[];
  };
  fn.flush = () => state.flushOnClose();
  return fn;
};
