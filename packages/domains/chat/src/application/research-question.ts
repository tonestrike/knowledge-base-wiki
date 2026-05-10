import type { Citation, WikiId } from '@package/contracts/shared';
import type { ResearcherOutput, WikiReader } from './ports.ts';

/**
 * "Search the pre-compiled wiki" — drops the legacy Researcher LLM call.
 *
 * The wiki was already extracted, structured, and grounded at compile
 * time: every WikiPage is prose tied to a curated `citations[]`. There is
 * no need for a second LLM round to re-extract findings — that work was
 * the whole point of the compile pipeline. We just rank wiki pages by
 * the question text (token overlap), then hand them to the Synthesizer
 * as ready-to-cite findings.
 *
 * This collapses chat from "two sequential LLM round trips" (15-40s to
 * first visible token) into "one streaming LLM round trip" (<1s to first
 * token, +5-10s for the full answer).
 */
export async function researchQuestion(
  deps: { wikiReader: WikiReader },
  input: {
    wikiId: WikiId;
    question: string;
    /** Optional progress callback, fired once the wiki search returns. */
    onPartial?: (partial: { findings: number }) => void;
  },
): Promise<ResearcherOutput> {
  const pages = await deps.wikiReader.searchPages({
    wikiId: input.wikiId,
    query: input.question,
    limit: 4,
  });
  // Each candidate wiki page is treated as one finding with the page's
  // entire citation pool available to the Synthesizer. The Synthesizer's
  // hash-verification step still validates each citation before any
  // event reaches the SSE tape, so we don't trust this list blindly.
  const findings: ResearcherOutput['findings'] = pages.map((p) => ({
    wikiPageId: p.id,
    quoteText: p.body,
    citationIds: p.citations.map((c: Citation) => c.id),
    citations: p.citations,
  }));
  input.onPartial?.({ findings: findings.length });
  return { pages, findings };
}
