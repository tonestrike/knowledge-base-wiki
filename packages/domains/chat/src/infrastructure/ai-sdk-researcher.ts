import type { WikiPageId } from '@package/contracts/shared';
import { type LanguageModelV1, generateObject } from 'ai';
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

Return JSON only.`;

const renderPages = (pages: ResearcherOutput['pages']): string =>
  pages
    .map((p) => {
      const citations = p.citations
        .map((c) => `<citation id="${c.id}" label="${c.label}"/>`)
        .join('\n');
      return `<page id="${p.id}" type="${p.pageType ?? ''}" title="${p.title}">\n${citations}\n${p.body}\n</page>`;
    })
    .join('\n');

export interface AiSdkResearcherOptions {
  model: LanguageModelV1;
  wikiReader: WikiReader;
  systemPrompt?: string;
  /** Candidate-page fetch limit before prompting. Defaults to 8. */
  candidateLimit?: number;
  temperature?: number;
  maxTokens?: number;
  /** Per-call timeout. Defaults to 60s. */
  timeoutMs?: number;
}

/**
 * Researcher adapter on Vercel AI SDK `generateObject`. Pulls candidate pages
 * via the injected `WikiReader` (so the chat domain never imports
 * `domains/wiki`), then asks the model to emit findings whose citation ids
 * are already present in the candidate pages. The use-case
 * `researchQuestion` re-validates the citation ids before they reach the
 * Synthesizer.
 *
 * SF-CHAT-5: every short-circuit branch (no candidates, unknown page id,
 * empty citations) logs a structured warning so the operator can spot
 * "Researcher returned 0 findings" in production logs without re-running
 * the prompt locally.
 */
export const createAiSdkResearcher = (opts: AiSdkResearcherOptions): Researcher => ({
  async research(input: ResearcherInput): Promise<ResearcherOutput> {
    const candidates = await opts.wikiReader.searchPages({
      wikiId: input.wikiId,
      query: input.question,
      limit: opts.candidateLimit ?? 8,
    });

    if (candidates.length === 0) {
      console.warn('[chat.ai-sdk-researcher] empty findings: no candidate pages', {
        wikiId: input.wikiId,
        question: input.question,
        candidateLimit: opts.candidateLimit ?? 8,
      });
      return { pages: [], findings: [] };
    }

    // Vercel AI SDK doesn't enforce its own request timeout, so a hung
    // OpenRouter call would freeze the dispatcher indefinitely (the user
    // sees "Researcher started · +0s" stuck for minutes). Wrap with an
    // AbortController so we surface a typed error instead of waiting forever.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 60_000);
    let result: { object: z.infer<typeof RawResearcherOutput> };
    try {
      result = await generateObject({
        model: opts.model,
        schema: RawResearcherOutput,
        schemaName: 'ResearchOutput',
        schemaDescription: 'Findings extracted from candidate wiki pages.',
        system: opts.systemPrompt ?? SYSTEM,
        prompt: `Question: ${input.question}\n\nPages:\n${renderPages({ pages: candidates, findings: [] }.pages)}`,
        temperature: opts.temperature ?? 0.1,
        maxTokens: opts.maxTokens ?? 1500,
        maxRetries: 1,
        abortSignal: ac.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (ac.signal.aborted) {
        throw new Error(
          `Researcher LLM call timed out after ${opts.timeoutMs ?? 60_000}ms — wiki=${input.wikiId}`,
        );
      }
      throw err;
    }
    clearTimeout(timer);

    const byPageId = new Map(candidates.map((p) => [p.id, p]));
    const findings: ResearcherOutput['findings'] = [];
    for (const f of result.object.findings) {
      const page = byPageId.get(f.wikiPageId as WikiPageId);
      if (!page) {
        console.warn('[chat.ai-sdk-researcher] dropping finding with unknown page id', {
          wikiId: input.wikiId,
          question: input.question,
          unknownPageId: f.wikiPageId,
          candidatePageIds: [...byPageId.keys()],
        });
        continue;
      }
      const cites = f.citationIds
        .map((id) => page.citations.find((c) => c.id === id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c));
      if (cites.length === 0) {
        console.warn('[chat.ai-sdk-researcher] dropping finding with no resolvable citations', {
          wikiId: input.wikiId,
          question: input.question,
          wikiPageId: f.wikiPageId,
          requestedCitationIds: f.citationIds,
          availableCitationIds: page.citations.map((c) => c.id),
        });
        continue;
      }
      findings.push({
        wikiPageId: page.id,
        quoteText: f.quoteText,
        citationIds: f.citationIds,
        citations: cites,
      });
    }
    if (findings.length === 0) {
      console.warn('[chat.ai-sdk-researcher] empty findings: model returned 0 usable findings', {
        wikiId: input.wikiId,
        question: input.question,
        candidatePageCount: candidates.length,
        modelFindingCount: result.object.findings.length,
      });
    }
    return { pages: candidates, findings };
  },
});
