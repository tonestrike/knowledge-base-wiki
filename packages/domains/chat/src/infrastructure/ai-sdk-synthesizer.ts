import { type LanguageModel, streamText, tool } from 'ai';
import { z } from 'zod';
import type { Synthesizer, SynthesizerEvent, SynthesizerInput } from '../application/ports.ts';

/**
 * Per-kind artifact tools. Each tool's `inputSchema` carries one artifact
 * kind's props (mirroring `@package/contracts/shared/artifact` minus the
 * `min(N)/max(N)` array refinements — those become JSON-Schema
 * `minItems`/`maxItems` constraints that the slice instructions ban for
 * structured-output prompts). Putting the artifact registry behind a tool
 * call sidesteps Anthropic's structured-output validator entirely: tool
 * schemas are checked one tool at a time, never compiled into a single
 * combined grammar, so we avoid both the "Empty schema ({}) that accepts any
 * JSON value is not supported" failure and the "compiled grammar is too
 * large" failure the previous `streamObject` adapter ran into.
 *
 * Each tool's `execute` is a no-op that returns the input back as the
 * result — `streamText` requires `execute` to be present to keep the
 * tool-call loop progressing, but the work itself happens downstream when
 * the use-case re-validates each artifact against the typed `Artifact`
 * registry. The actual artifact payload travels in the tool *input*, which
 * we surface as an `artifact` segment.
 */
const citationIds = z
  .array(z.string())
  .describe('Citation ids that ground this artifact. Must be drawn from the provided findings.');

const buildArtifactTools = () => ({
  ComparisonTable: tool({
    description:
      'Use when comparing two or more items, options, or entities side-by-side. ' +
      'Columns name the dimensions; each row is one item; each cell is one comparison value.',
    inputSchema: z.object({
      columns: z.array(z.string()),
      rows: z.array(
        z.object({
          cells: z.array(
            z.object({
              value: z.string(),
              citationId: z.string().optional(),
            }),
          ),
        }),
      ),
      citationIds,
    }),
    execute: async (input) => input,
  }),
  Timeline: tool({
    description: 'Use for two or more dated events, milestones, or version bumps.',
    inputSchema: z.object({
      events: z.array(
        z.object({
          at: z.string(),
          label: z.string(),
          description: z.string().optional(),
          citationId: z.string().optional(),
        }),
      ),
      citationIds,
    }),
    execute: async (input) => input,
  }),
  LineChart: tool({
    description: 'Use for time-series numbers or trends across labels (one or more named series).',
    inputSchema: z.object({
      xLabel: z.string(),
      yLabel: z.string(),
      series: z.array(
        z.object({
          name: z.string(),
          points: z.array(
            z.object({
              x: z.union([z.string(), z.number()]),
              y: z.number(),
              citationId: z.string().optional(),
            }),
          ),
        }),
      ),
      citationIds,
    }),
    execute: async (input) => input,
  }),
  BarChart: tool({
    description: 'Use for discrete categorical magnitudes (one bar per item).',
    inputSchema: z.object({
      xLabel: z.string(),
      yLabel: z.string(),
      bars: z.array(
        z.object({
          x: z.union([z.string(), z.number()]),
          y: z.number(),
          citationId: z.string().optional(),
        }),
      ),
      citationIds,
    }),
    execute: async (input) => input,
  }),
  KeyMetric: tool({
    description: 'Use for a single headline number, ratio, or percent the user would underline.',
    inputSchema: z.object({
      label: z.string(),
      value: z.string(),
      delta: z.string().optional(),
      trend: z.enum(['up', 'down', 'flat']).optional(),
      citationId: z.string().optional(),
      citationIds,
    }),
    execute: async (input) => input,
  }),
  CodeBlock: tool({
    description: 'Use for any code snippet (commands, config, source).',
    inputSchema: z.object({
      language: z.string(),
      source: z.string(),
      citationIds,
    }),
    execute: async (input) => input,
  }),
  Quote: tool({
    description: 'Use for a verbatim quote longer than ~12 words.',
    inputSchema: z.object({
      text: z.string(),
      attribution: z.string().optional(),
      citationId: z.string().optional(),
      citationIds,
    }),
    execute: async (input) => input,
  }),
  Markdown: tool({
    description:
      'Use for a multi-paragraph passage that benefits from headings, lists, or emphasis but ' +
      "doesn't fit any other artifact kind.",
    inputSchema: z.object({
      body: z.string(),
      citationIds,
    }),
    execute: async (input) => input,
  }),
});

type ArtifactToolName =
  | 'ComparisonTable'
  | 'Timeline'
  | 'LineChart'
  | 'BarChart'
  | 'KeyMetric'
  | 'CodeBlock'
  | 'Quote'
  | 'Markdown';

const ARTIFACT_TOOL_NAMES: ReadonlySet<string> = new Set<ArtifactToolName>([
  'ComparisonTable',
  'Timeline',
  'LineChart',
  'BarChart',
  'KeyMetric',
  'CodeBlock',
  'Quote',
  'Markdown',
]);

const SYSTEM_PROMPT = `You are Synthesizer. Compose an Answer to the user's question using ONLY the provided findings.

Output format:
- Write the answer as natural prose. Citations are inline markers: write [[cite:CITATION_ID]] immediately after any factual claim, using one of the citation ids attached to the matching finding.
- For structured data, call ONE of the artifact tools (ComparisonTable / Timeline / LineChart / BarChart / KeyMetric / CodeBlock / Quote / Markdown) instead of writing prose. Each tool call counts as one segment of the answer; the user sees it rendered as a chart/table/quote/etc.

Rules:
- Every factual claim in prose MUST be paired with an inline [[cite:CITATION_ID]] marker.
- Every artifact tool call MUST list one or more citation ids in its \`citationIds\` array, drawn from the provided findings.
- Do not invent citation ids — only use ids that appear in the findings.
- Open with one short prose sentence introducing the answer; close with one short prose takeaway.
- Aim for 3–10 segments total (prose runs + tool calls combined). Be concise.

Prefer artifacts over plain prose whenever the data fits. They are NOT optional decoration — they are how the user reads structured information. Triggers:

- Two or more comparable items / options / entities → ComparisonTable.
- Two or more dated events, milestones, or version bumps → Timeline.
- A single headline number, ratio, or percent the user would underline → KeyMetric.
- Time-series numbers (dates → values), or trends across labels → LineChart.
- Discrete categorical magnitudes (one bar per item) → BarChart.
- A verbatim quote longer than ~12 words → Quote.
- Any code snippet (commands, config, source) → CodeBlock.
- A multi-paragraph passage that doesn't fit any of the above but benefits from headings, lists, or emphasis → Markdown.

A typical answer that surfaces structured data uses 1–3 artifact tool calls. If the question is purely conceptual ("what does X mean?") prose with inline citations is fine — but always check whether a Quote or KeyMetric would land better.

If earlier user/assistant turns precede the current question, treat them as conversation history. Resolve pronouns and topic continuations ("him", "that", "why was that important") against them. The *grounded findings for the current question* are only the ones in the live user message — never invent citation ids from prior turns even if a previous answer referenced them.

If the findings clearly do NOT answer the question — e.g. the user asks about something the wiki doesn't cover, or sends a non-question like "hi" — open with one short prose sentence that names the mismatch ("This wiki doesn't seem to cover that directly, but…") and then call ComparisonTable (or Markdown) to surface 2–4 of the most distinctive topics from the findings as concrete follow-up suggestions. End with a single takeaway sentence that invites the user to pick one. Never refuse silently; always ground guidance in actual finding text.`;

const renderFindings = (input: SynthesizerInput): string =>
  input.findings
    .map((f) => `<finding citationIds="${f.citationIds.join(',')}">\n${f.quoteText}\n</finding>`)
    .join('\n');

export interface AiSdkSynthesizerOptions {
  model: LanguageModel;
  /** Optional override for the system prompt — primarily for evaluation harnesses. */
  systemPrompt?: string;
  /** Defaults to 0.4 — enough variety for prose, low enough to stay grounded. */
  temperature?: number;
  /** Defaults to 4000. */
  maxTokens?: number;
  /** Optional model identifier for log lines (e.g. 'anthropic/claude-sonnet-4.6'). */
  modelName?: string;
  /** Per-call timeout. Defaults to 90s. */
  timeoutMs?: number;
}

const errorId = (): string => {
  const r =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return r.slice(0, 8);
};

// `[[cite:UUID]]` — UUID-shaped to avoid eating literal brackets in prose.
const CITE_MARKER = /\[\[cite:([0-9a-fA-F-]{8,})\]\]/;

interface SegmentState {
  /** Next segment index to allocate. */
  nextIndex: number;
  /** Index of the currently-open prose segment (null if no prose run is open). */
  proseIndex: number | null;
  /** Accumulated text of the currently-open prose segment. */
  proseText: string;
  /** Buffered tail of `text-delta` that hasn't been scanned for citation markers yet. */
  pending: string;
}

const newState = (): SegmentState => ({
  nextIndex: 0,
  proseIndex: null,
  proseText: '',
  pending: '',
});

/**
 * Close the currently-open prose run (if any) by emitting a settled `segment`
 * with `kind: 'prose'`. After this, `proseIndex` is null and a fresh prose
 * run will be opened by the next prose delta.
 */
function* closeProse(state: SegmentState): Generator<SynthesizerEvent> {
  if (state.proseIndex === null) return;
  if (state.proseText.length > 0) {
    yield {
      kind: 'segment',
      index: state.proseIndex,
      segment: { kind: 'prose', text: state.proseText },
    };
  }
  state.proseIndex = null;
  state.proseText = '';
}

/**
 * Append a chunk of prose text to the open prose run, opening a new prose
 * segment if none is currently open. Yields a `proseDelta` for the chunk.
 */
function* emitProse(state: SegmentState, text: string): Generator<SynthesizerEvent> {
  if (text.length === 0) return;
  if (state.proseIndex === null) {
    state.proseIndex = state.nextIndex++;
    state.proseText = '';
  }
  state.proseText += text;
  yield { kind: 'proseDelta', segmentIndex: state.proseIndex, textDelta: text };
}

/**
 * Scan the pending buffer for `[[cite:UUID]]` markers. Emits any text before
 * a complete marker as a prose delta, then closes the open prose run and
 * yields a `citation` segment. The trailing fragment (which might be the
 * start of an unfinished marker) stays in `state.pending` for the next call.
 */
function* drainPending(state: SegmentState, isFinal: boolean): Generator<SynthesizerEvent> {
  while (true) {
    const match = state.pending.match(CITE_MARKER);
    if (!match) break;
    const before = state.pending.slice(0, match.index ?? 0);
    if (before.length > 0) yield* emitProse(state, before);
    yield* closeProse(state);
    const citationId = match[1] ?? '';
    yield {
      kind: 'segment',
      index: state.nextIndex++,
      segment: { kind: 'citation', citationId },
    };
    state.pending = state.pending.slice((match.index ?? 0) + match[0].length);
  }
  // On a non-final pass, hold back any trailing fragment that could grow
  // into a complete `[[cite:UUID]]` marker once more text arrives. The
  // tricky case is `[[cite:UUID` split across three deltas:
  //
  //   delta A: "... Hathaway ["
  //   delta B: "[cite:09ed..."
  //   delta C: "]]."
  //
  // After delta A we must hold back the LAST `[` (it might become `[[`),
  // not flush it as prose. After delta B we must hold back from the FIRST
  // `[` — using `lastIndexOf('[')` would pick the `[` inside `[cite:` and
  // strand the opening `[` upstream as prose. The correct rule:
  //
  //   1. If a `[[` substring exists with no `]]` after it, hold back from
  //      that `[[` — it's an open, unclosed marker.
  //   2. Otherwise, if the buffer ends with a lone `[`, hold back that one
  //      char — it might become `[[` on the next delta.
  //   3. Otherwise the buffer can't possibly extend into a marker; flush.
  if (!isFinal) {
    let holdFrom = -1;
    const lastDouble = state.pending.lastIndexOf('[[');
    if (lastDouble >= 0 && state.pending.indexOf(']]', lastDouble) === -1) {
      holdFrom = lastDouble;
    } else if (state.pending.endsWith('[')) {
      holdFrom = state.pending.length - 1;
    }
    if (holdFrom >= 0) {
      const flushable = state.pending.slice(0, holdFrom);
      if (flushable.length > 0) yield* emitProse(state, flushable);
      state.pending = state.pending.slice(holdFrom);
      return;
    }
  }
  if (state.pending.length > 0) {
    yield* emitProse(state, state.pending);
    state.pending = '';
  }
}

/**
 * Bridge `streamText({ tools })` into the domain's `Synthesizer` port.
 *
 * Backend strategy:
 *   - Per-kind artifact tools (no combined schema) → Anthropic accepts them.
 *   - Prose flows as plain text; citations are inline `[[cite:UUID]]`
 *     markers that this adapter parses out of the text stream and emits as
 *     separate `citation` segments.
 *   - Each tool call becomes one `artifact` segment carrying the tool's
 *     input; the use-case re-validates the artifact against the full typed
 *     registry (with min/max refinements) before any segment reaches the
 *     SSE tape.
 *
 * SF-CHAT-4: errors thrown by `streamText` (construction or iteration) are
 * caught, logged with `errorId`, model name, and segments emitted so far,
 * then re-thrown so the use-case's outer catch can shape them into an
 * `AnswerFailed` event with the same correlation id.
 */
export const createAiSdkSynthesizer = (opts: AiSdkSynthesizerOptions): Synthesizer => ({
  async *stream(input: SynthesizerInput): AsyncIterable<SynthesizerEvent> {
    // Without an abortSignal + wall-clock deadline a hung OpenRouter call
    // would freeze the SSE stream forever and the user just sees the
    // shimmering placeholder.
    const ac = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 90_000;
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    // Build the messages array. Prior turns are threaded in as
    // user/assistant pairs so pronouns and topic continuations in the
    // current question resolve against real prior context. The findings
    // for the *current* turn are concatenated into the live user message
    // so the Synthesizer always grounds against this turn's research
    // output (older findings would just bloat the prompt — the Researcher
    // already re-ran for this turn).
    const messages: Array<
      { role: 'user'; content: string } | { role: 'assistant'; content: string }
    > = [];
    if (input.history) {
      for (const t of input.history) {
        messages.push({ role: 'user', content: t.question });
        messages.push({ role: 'assistant', content: t.answerText });
      }
    }
    messages.push({
      role: 'user',
      content: `Question: ${input.question}\n\nFindings:\n${renderFindings(input)}`,
    });

    // Inline assignment so TS infers the parameterized
    // `StreamTextResult<typeof tools>` rather than narrowing to the
    // un-parameterized return type. The construction itself is synchronous
    // but can throw on invalid options; we keep the try/catch around it to
    // attach the same correlation-id log the previous adapter did.
    const buildResult = () =>
      streamText({
        model: opts.model,
        tools: buildArtifactTools(),
        toolChoice: 'auto',
        system: opts.systemPrompt ?? SYSTEM_PROMPT,
        messages,
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.maxTokens ?? 4000,
        maxRetries: 1,
        abortSignal: ac.signal,
      });

    let result: ReturnType<typeof buildResult>;
    try {
      result = buildResult();
    } catch (err) {
      clearTimeout(timer);
      const id = errorId();
      console.error('[chat.ai-sdk-synthesizer] streamText construction failed', {
        errorId: id,
        modelName: opts.modelName,
        err:
          err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
      });
      throw err;
    }

    const deadline = Date.now() + timeoutMs;
    const state = newState();
    let segmentsEmitted = 0;

    try {
      const iterator = result.fullStream[Symbol.asyncIterator]();
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(`Synthesizer LLM stream timed out after ${timeoutMs}ms`);
        }
        const next = (await Promise.race([
          iterator.next(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Synthesizer LLM stream timed out after ${timeoutMs}ms`)),
              remaining,
            ),
          ),
        ])) as IteratorResult<{ type: string } & Record<string, unknown>>;
        if (next.done) break;
        const part = next.value;
        if (part.type === 'text-delta' && typeof part.text === 'string') {
          state.pending += part.text;
          yield* drainPending(state, false);
          continue;
        }
        if (part.type === 'tool-call') {
          // Flush any pending prose first so segment indices stay ordered.
          yield* drainPending(state, true);
          yield* closeProse(state);
          const toolName = String(part.toolName ?? '');
          if (!ARTIFACT_TOOL_NAMES.has(toolName)) continue;
          const inputObj = (part.input ?? {}) as Record<string, unknown>;
          const cIds = Array.isArray(inputObj.citationIds)
            ? (inputObj.citationIds as string[])
            : [];
          // Strip `citationIds` from the props payload — it lives at the
          // artifact root in the typed registry.
          const { citationIds: _drop, ...props } = inputObj;
          yield {
            kind: 'segment',
            index: state.nextIndex++,
            segment: {
              kind: 'artifact',
              artifact: {
                kind: toolName as ArtifactToolName,
                props,
                citationIds: cIds,
              },
            },
          };
          segmentsEmitted += 1;
        }
        // Other part kinds (start/finish/tool-input-*/reasoning/etc.) are
        // not used by the domain port; ignore them.
      }
      // End-of-stream: flush any pending text and close the open prose run.
      yield* drainPending(state, true);
      yield* closeProse(state);
    } catch (err) {
      const id = errorId();
      console.error('[chat.ai-sdk-synthesizer] fullStream threw', {
        errorId: id,
        modelName: opts.modelName,
        segmentsEmitted,
        err:
          err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
      });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },
});
