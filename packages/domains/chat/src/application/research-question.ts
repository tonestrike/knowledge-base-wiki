import type { WikiId } from '@package/contracts/shared';
import type { Researcher, ResearcherOutput, WikiPageSummary, WikiReader } from './ports.ts';

/**
 * Fast-path threshold: skip the agentic loop entirely when a single
 * direct search already returns this many candidates whose top hit has a
 * substantive body. Tuned against the demo wikis — when the user phrasing
 * happens to match the wiki's vocabulary (common case), the agent loop's
 * 20-45s round-trips don't actually surface anything the cheap D1 search
 * missed.
 */
const FAST_PATH_MIN_PAGES = 4;
const FAST_PATH_MIN_TOP_BODY = 500;
/** Per-page search cap for the fast-path probe. Tighter than the agent's
 *  `searchLimit` since this round is gated by `FAST_PATH_MIN_PAGES`. */
const FAST_PATH_SEARCH_LIMIT = 8;

const pagesToOutput = (pages: WikiPageSummary[]): ResearcherOutput => ({
  pages,
  findings: pages.map((p) => ({
    wikiPageId: p.id,
    quoteText: p.body,
    citationIds: p.citations.map((c) => c.id),
    citations: p.citations,
  })),
});

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
 *
 * Latency fast-path: a cheap `searchPages` round runs first; if it hands
 * back ≥`FAST_PATH_MIN_PAGES` pages with a substantive top hit
 * (≥`FAST_PATH_MIN_TOP_BODY` chars), we skip the agent loop entirely —
 * the additional agent round-trips wouldn't surface much the direct
 * search missed. The `onPageVisited` / `onPartial` callbacks still fire
 * so the UI sees the same WikiPageRetrieved events.
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
  const direct = await deps.wikiReader.searchPages({
    wikiId: input.wikiId,
    query: input.question,
    limit: FAST_PATH_SEARCH_LIMIT,
  });
  const topBodyLen = direct[0]?.body.length ?? 0;
  if (direct.length >= FAST_PATH_MIN_PAGES && topBodyLen > FAST_PATH_MIN_TOP_BODY) {
    for (const p of direct) input.onPageVisited?.(p);
    input.onPartial?.({ findings: direct.length });
    return pagesToOutput(direct);
  }

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
