import type {
  Researcher,
  ResearcherInput,
  ResearcherOutput,
  WikiReader,
} from '../application/ports.ts';

export interface DirectWikiResearcherOptions {
  wikiReader: WikiReader;
  /** How many candidate pages to pull per question. Defaults to 4 (matches
   *  the legacy behavior baked into `researchQuestion` before the
   *  port-delegation refactor). */
  candidateLimit?: number;
}

/**
 * Fast-path Researcher that does exactly one wiki search and treats each
 * surfaced page as a finding. No LLM round-trip, no iteration. Used in
 * unit tests and when the api boots without `OPEN_ROUTER_API_KEY`, so
 * the chat surface keeps working without a model.
 *
 * Production builds wire {@link createAgenticResearcher} instead so the
 * agent can iterate (search → drill → re-search with refined queries)
 * before handing findings to the synthesizer.
 */
export const createDirectWikiResearcher = (opts: DirectWikiResearcherOptions): Researcher => ({
  async research(input: ResearcherInput): Promise<ResearcherOutput> {
    const limit = opts.candidateLimit ?? 4;
    const pages = await opts.wikiReader.searchPages({
      wikiId: input.wikiId,
      query: input.question,
      limit,
    });
    const findings: ResearcherOutput['findings'] = pages.map((p) => ({
      wikiPageId: p.id,
      quoteText: p.body,
      citationIds: p.citations.map((c) => c.id),
      citations: p.citations,
    }));
    input.onPartial?.({ findings: findings.length });
    for (const p of pages) input.onPageVisited?.(p);
    return { pages, findings };
  },
});
