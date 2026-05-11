import type { WikiId } from '@package/contracts/shared';
import type { Researcher, ResearcherOutput, WikiPageSummary, WikiReader } from './ports.ts';

/**
 * Run the chat-domain Researcher port and supplement its output with the
 * empty-findings fallback every implementation needs.
 *
 * The Researcher decides *how* to find pages — for the demo wiki an
 * agentic ToolLoopAgent iterates search→drill→re-search, but a fast
 * direct-search adapter is wired when no LLM is available (tests, no
 * OPEN_ROUTER_API_KEY). Whichever implementation runs, this function
 * guarantees the empty-question case still hands the synthesizer a
 * concrete sample of what the wiki covers, so the model can compose a
 * "I couldn't match that, here's what's in here" reply instead of
 * dead-ending.
 *
 * Keeping the fallback here (rather than inside each Researcher impl)
 * means the agent stays focused on the search problem and the dispatcher
 * never sees an output without either findings OR suggestionPages.
 */
export async function researchQuestion(
  deps: { researcher: Researcher; wikiReader: WikiReader },
  input: {
    wikiId: WikiId;
    question: string;
    /** Forwarded to the Researcher impl. Fires per finding/page surfaced. */
    onPartial?: (partial: { findings: number }) => void;
    /** Forwarded to the Researcher impl. Fires per page pulled into context. */
    onPageVisited?: (page: WikiPageSummary) => void;
  },
): Promise<ResearcherOutput> {
  const out = await deps.researcher.research({
    wikiId: input.wikiId,
    question: input.question,
    ...(input.onPartial ? { onPartial: input.onPartial } : {}),
    ...(input.onPageVisited ? { onPageVisited: input.onPageVisited } : {}),
  });

  // If the Researcher already hand-picked suggestion pages, respect them.
  if (out.findings.length === 0 && (out.suggestionPages?.length ?? 0) === 0) {
    const suggestionPages = await deps.wikiReader.listSamplePages({
      wikiId: input.wikiId,
      limit: 6,
    });
    return { ...out, suggestionPages };
  }
  return out;
}
