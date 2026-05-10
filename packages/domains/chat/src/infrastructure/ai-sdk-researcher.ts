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
}

/**
 * Researcher adapter on Vercel AI SDK `generateObject`. Pulls candidate pages
 * via the injected `WikiReader` (so the chat domain never imports
 * `domains/wiki`), then asks the model to emit findings whose citation ids
 * are already present in the candidate pages. The use-case
 * `researchQuestion` re-validates the citation ids before they reach the
 * Synthesizer.
 */
export const createAiSdkResearcher = (opts: AiSdkResearcherOptions): Researcher => ({
  async research(input: ResearcherInput): Promise<ResearcherOutput> {
    const candidates = await opts.wikiReader.searchPages({
      wikiId: input.wikiId,
      query: input.question,
      limit: opts.candidateLimit ?? 8,
    });

    if (candidates.length === 0) return { pages: [], findings: [] };

    const result = await generateObject({
      model: opts.model,
      schema: RawResearcherOutput,
      schemaName: 'ResearchOutput',
      schemaDescription: 'Findings extracted from candidate wiki pages.',
      system: opts.systemPrompt ?? SYSTEM,
      prompt: `Question: ${input.question}\n\nPages:\n${renderPages({ pages: candidates, findings: [] }.pages)}`,
      temperature: opts.temperature ?? 0.1,
      maxTokens: opts.maxTokens ?? 1500,
    });

    const byPageId = new Map(candidates.map((p) => [p.id, p]));
    const findings: ResearcherOutput['findings'] = [];
    for (const f of result.object.findings) {
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
