import { type LanguageModelV1, streamObject } from 'ai';
import { z } from 'zod';
import type { Synthesizer, SynthesizerEvent, SynthesizerInput } from '../application/ports.ts';

/**
 * The Synthesizer's structured-output schema. The closed `ArtifactKind`
 * registry is enforced as a tagged union; `props` is a `z.unknown()` here
 * because the model's per-kind props shape is re-validated against the typed
 * `Artifact` registry at the use-case boundary. We keep the per-kind shape
 * out of this schema deliberately:
 *
 *   - The user's slice instructions ban JSON-Schema `minItems`/`maxItems`
 *     other than 0/1 (they degrade structured-output quality on some
 *     providers); the typed registry's `min(2).max(8)` etc. live in the
 *     contract layer and run as Zod refinements after streaming.
 *   - Keeping the schema flat improves streaming behavior: `streamObject`
 *     with `output: 'array'` emits each element as soon as it parses.
 */
const RawSegmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prose'), text: z.string() }),
  z.object({ kind: z.literal('citation'), citationId: z.string() }),
  z.object({
    kind: z.literal('artifact'),
    artifact: z.object({
      kind: z.enum([
        'ComparisonTable',
        'Timeline',
        'LineChart',
        'BarChart',
        'KeyMetric',
        'CodeBlock',
        'Quote',
        'Markdown',
      ]),
      props: z.unknown(),
      citationIds: z.array(z.string()),
    }),
  }),
]);

const SYSTEM_PROMPT = `You are Synthesizer. Compose an Answer to the user's question using ONLY the provided findings.

Hard rules:
- Output an array of AnswerSegments. Each segment is one of:
    { kind: "prose", text: <string> }
    { kind: "citation", citationId: <one of the provided ids> }
    { kind: "artifact", artifact: { kind, props, citationIds: [<ids>] } }
- Every prose claim that asserts a fact MUST be paired with a "citation" segment immediately after it.
- Where a comparison, trend, code, quote, or single metric is the clearest form, emit ONE "artifact" segment using the closed registry: ComparisonTable | Timeline | LineChart | BarChart | KeyMetric | CodeBlock | Quote | Markdown.
- Each artifact MUST list one or more citationIds.
- Only use citationIds that appear in the provided findings. Do NOT invent ids.
- The first segment is usually short prose introducing the answer; the last segment is a takeaway sentence.
- Aim for 3–10 segments total. Be concise.

Per-artifact prop shapes:
- ComparisonTable: { columns: string[], rows: [{ cells: [{ value, citationId? }] }] }   // 2–8 columns; cells.length === columns.length
- Timeline: { events: [{ at, label, description?, citationId? }] }
- LineChart: { xLabel, yLabel, series: [{ name, points: [{ x, y, citationId? }] }] }
- BarChart: { xLabel, yLabel, bars: [{ x, y, citationId? }] }
- KeyMetric: { label, value, delta?, trend?: "up"|"down"|"flat", citationId? }
- CodeBlock: { language, source }
- Quote: { text, attribution?, citationId? }
- Markdown: { body }

Return JSON only. No prose preamble outside the array elements.`;

const renderFindings = (input: SynthesizerInput): string =>
  input.findings
    .map((f) => `<finding citationIds="${f.citationIds.join(',')}">\n${f.quoteText}\n</finding>`)
    .join('\n');

export interface AiSdkSynthesizerOptions {
  model: LanguageModelV1;
  /** Optional override for the system prompt — primarily for evaluation harnesses. */
  systemPrompt?: string;
  /** Defaults to 0.4 — enough variety for prose, low enough to stay grounded. */
  temperature?: number;
  /** Defaults to 4000. */
  maxTokens?: number;
}

/**
 * Bridge `streamObject({ output: 'array' })` into the domain's `Synthesizer`
 * port. Each parsed array element fires a `segment` event with a monotonically
 * increasing index; full-object validation lives in the use-case (the typed
 * `Artifact` registry validates per-kind props as a Zod refinement).
 *
 * No Anthropic prefill; no `minItems`/`maxItems` other than 0/1 in the
 * schema. The constraints live in the prompt and in the post-stream
 * `Artifact.safeParse(...)` in the use-case.
 */
export const createAiSdkSynthesizer = (opts: AiSdkSynthesizerOptions): Synthesizer => ({
  async *stream(input: SynthesizerInput): AsyncIterable<SynthesizerEvent> {
    const result = streamObject({
      model: opts.model,
      output: 'array',
      schema: RawSegmentSchema,
      schemaName: 'AnswerSegments',
      schemaDescription: 'An ordered list of AnswerSegments composing the Answer.',
      system: opts.systemPrompt ?? SYSTEM_PROMPT,
      prompt: `Question: ${input.question}\n\nFindings:\n${renderFindings(input)}`,
      temperature: opts.temperature ?? 0.4,
      maxTokens: opts.maxTokens ?? 4000,
    });

    let index = 0;
    for await (const element of result.elementStream) {
      yield { kind: 'segment', index, segment: toRawSegment(element) };
      index += 1;
    }
  },
});

const toRawSegment = (
  el: z.infer<typeof RawSegmentSchema>,
): SynthesizerEvent extends infer _
  ? Extract<SynthesizerEvent, { kind: 'segment' }>['segment']
  : never => {
  if (el.kind === 'prose') return { kind: 'prose', text: el.text };
  if (el.kind === 'citation') return { kind: 'citation', citationId: el.citationId };
  return {
    kind: 'artifact',
    artifact: {
      kind: el.artifact.kind,
      props: el.artifact.props,
      citationIds: el.artifact.citationIds,
    },
  };
};
