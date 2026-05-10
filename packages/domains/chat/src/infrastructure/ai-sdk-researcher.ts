import type { WikiPageId } from '@package/contracts/shared';
import { type LanguageModel, streamObject } from 'ai';
import { z } from 'zod';
import type {
  Researcher,
  ResearcherInput,
  ResearcherOutput,
  WikiReader,
} from '../application/ports.ts';

const RawResearcherOutput = z.object({
  findings: z.array(
    z.object({
      wikiPageId: z.string(),
      quoteText: z.string(),
      citationIds: z.array(z.string()),
    }),
  ),
});

const SYSTEM = `You are Researcher. Read the candidate wiki pages and extract findings that answer the question.

Hard rules:
- For each relevant page, emit one or more findings.
- Each finding MUST quote the relevant text VERBATIM from the page body.
- citationIds MUST be ids that already appear in the page's <citation/> entries.
- Do NOT invent citation ids. Do NOT paraphrase.
- If no page is relevant, return { findings: [] }.

Be concise — quotes should be ≤ 200 chars and you should emit at most 6 findings total.

Return JSON only.`;

// Trim each page body to keep the Researcher prompt bounded. Prior 4K cap
// produced prompts in the 30-50K-token range with 8 candidates and Sonnet
// 4.6 on OpenRouter would occasionally just stall before emitting any
// tokens. 1500 chars × 4 candidates = ~6K tokens — well inside the sweet
// spot for fast first-token latency on structured output.
const PAGE_BODY_CHAR_CAP = 1500;

const renderPages = (pages: ResearcherOutput['pages']): string =>
  pages
    .map((p) => {
      const citations = p.citations
        .map((c) => `<citation id="${c.id}" label="${c.label}"/>`)
        .join('\n');
      const body =
        p.body.length > PAGE_BODY_CHAR_CAP
          ? `${p.body.slice(0, PAGE_BODY_CHAR_CAP)}…[truncated]`
          : p.body;
      return `<page id="${p.id}" type="${p.pageType ?? ''}" title="${p.title}">\n${citations}\n${body}\n</page>`;
    })
    .join('\n');

export interface AiSdkResearcherOptions {
  model: LanguageModel;
  wikiReader: WikiReader;
  systemPrompt?: string;
  /** Candidate-page fetch limit before prompting. Defaults to 4. */
  candidateLimit?: number;
  temperature?: number;
  maxTokens?: number;
  /** Per-call timeout. Defaults to 90s — applies to the FULL stream, not first token. */
  timeoutMs?: number;
  /**
   * Optional progress callback fired as findings stream in. The Researcher
   * passes a snapshot of the partial findings array each time the model
   * emits enough JSON to make a new entry parseable. Use this to emit
   * `ResearchProgress` SSE events to the chat UI so the user sees real
   * incremental progress instead of staring at a "researching..." spinner.
   */
  onPartial?: (partial: { findings: number }) => void;
}

/**
 * Researcher adapter on Vercel AI SDK `streamObject`. Pulls candidate pages
 * via the injected `WikiReader` (chat domain never imports `domains/wiki`),
 * then streams findings out of the model. We use `partialObjectStream`
 * instead of `generateObject` so we get visible progress as fields parse —
 * `generateObject` only returns once the *entire* response is generated,
 * which on Sonnet 4.6 / OpenRouter routinely takes 30-90s for a research
 * prompt and gives the UI nothing to show in the meantime.
 *
 * The use-case `researchQuestion` re-validates citation ids before they
 * reach the Synthesizer, so dropping `generateObject`'s schema-strictness
 * for `streamObject`'s eager parsing is safe — bad findings still get
 * filtered downstream.
 */
export const createAiSdkResearcher = (opts: AiSdkResearcherOptions): Researcher => ({
  async research(input: ResearcherInput): Promise<ResearcherOutput> {
    const candidates = await opts.wikiReader.searchPages({
      wikiId: input.wikiId,
      query: input.question,
      limit: opts.candidateLimit ?? 4,
    });

    if (candidates.length === 0) {
      console.warn('[chat.ai-sdk-researcher] empty findings: no candidate pages', {
        wikiId: input.wikiId,
        question: input.question,
        candidateLimit: opts.candidateLimit ?? 4,
      });
      return { pages: [], findings: [] };
    }

    const timeoutMs = opts.timeoutMs ?? 90_000;
    const result = streamObject({
      model: opts.model,
      schema: RawResearcherOutput,
      schemaName: 'ResearchOutput',
      schemaDescription: 'Findings extracted from candidate wiki pages.',
      system: opts.systemPrompt ?? SYSTEM,
      prompt: `Question: ${input.question}\n\nPages:\n${renderPages(candidates)}`,
      temperature: opts.temperature ?? 0.1,
      maxOutputTokens: opts.maxTokens ?? 1500,
      maxRetries: 1,
    });

    // Race the partial stream against a wall-clock deadline. Each
    // partialObjectStream tick resets nothing — once we hit `timeoutMs`
    // we throw, and the dispatcher's outer catch turns it into
    // AnswerFailed.
    const deadline = Date.now() + timeoutMs;
    let lastFindingCount = 0;
    try {
      const iterator = result.partialObjectStream[Symbol.asyncIterator]();
      while (true) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(
            `Researcher LLM stream timed out after ${timeoutMs}ms — wiki=${input.wikiId}`,
          );
        }
        const next = (await Promise.race([
          iterator.next(),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `Researcher LLM stream timed out after ${timeoutMs}ms — wiki=${input.wikiId}`,
                  ),
                ),
              remaining,
            ),
          ),
        ])) as IteratorResult<Partial<z.infer<typeof RawResearcherOutput>>>;
        if (next.done) break;
        const findings = Array.isArray(next.value?.findings) ? next.value.findings : [];
        if (findings.length > lastFindingCount) {
          lastFindingCount = findings.length;
          opts.onPartial?.({ findings: findings.length });
          // Per-call onPartial from researcher_input wins when provided —
          // the dispatcher can attach a turn-scoped callback without
          // mutating the adapter's construction-time options.
          input.onPartial?.({ findings: findings.length });
        }
      }
    } catch (err) {
      console.error('[chat.ai-sdk-researcher] partialObjectStream threw', {
        wikiId: input.wikiId,
        question: input.question,
        candidatePageCount: candidates.length,
        err:
          err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
      });
      throw err;
    }

    // After the stream drains, .object resolves to the validated final result.
    const final = await result.object;

    const byPageId = new Map(candidates.map((p) => [p.id, p]));
    const findings: ResearcherOutput['findings'] = [];
    for (const f of final.findings) {
      const page = byPageId.get(f.wikiPageId as WikiPageId);
      if (!page) continue;
      const cites = f.citationIds
        .map((id) => page.citations.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c));
      if (cites.length === 0) continue;
      findings.push({
        wikiPageId: page.id,
        quoteText: f.quoteText,
        citationIds: f.citationIds,
        citations: cites,
      });
    }
    return { pages: candidates, findings };
  },
});
