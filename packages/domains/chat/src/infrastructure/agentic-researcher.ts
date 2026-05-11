import type { WikiPageId } from '@package/contracts/shared';
import { type LanguageModel, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import type {
  Researcher,
  ResearcherInput,
  ResearcherOutput,
  WikiPageSummary,
  WikiReader,
} from '../application/ports.ts';

const SOURCE_SEARCH_LIMIT = 6;

/**
 * "Really try hard." A ToolLoopAgent-style researcher built on
 * `streamText({ tools, stopWhen })`. The model decides what to search
 * for, drills into promising hits, and may follow up with a refined
 * query before declaring it has enough context.
 *
 * Three tools:
 *   - `searchWiki({ query })`     — token-overlap search over page
 *                                   title + compiled body
 *   - `readWikiPage({ pageId })`  — full body + citation list for a hit
 *   - `searchSources({ query })`  — token-overlap search over the raw
 *                                   source text (PDF extract, markdown)
 *                                   for every Source cited anywhere in
 *                                   this wiki. Returns citing pages so
 *                                   the agent can drill back into real
 *                                   WikiPages. The fallback when page
 *                                   search misses content the user's
 *                                   phrasing should plausibly hit.
 *
 * Loop budget: the agent stops after `maxSteps` generations (default 8).
 * The output text the model produces during the loop is discarded — the
 * synthesizer composes the user-facing answer downstream from the
 * aggregated findings.
 *
 * Page deduplication: the same wiki page may be surfaced multiple times
 * (initial search + a later drill-down + a source-search citing page).
 * We dedupe by id and only fire `onPageVisited` the first time. The
 * synthesizer dedupes findings by page id internally via the citation-id
 * set, but emitting one finding per unique page keeps the synth prompt
 * smaller.
 */
const SYSTEM = `You are Researcher. Your job is to find AS MANY relevant wiki pages as possible so that another agent can compose a thorough, well-cited answer. The wiki was compiled from underlying source documents (PDFs, markdown). You have three tools — use them all.

Workflow (you MUST follow):
1. Call \`searchWiki\` with the user's exact phrasing first. Read every title and snippet that comes back.
2. Even if the first search looks decent, call \`searchWiki\` AGAIN with at least one alternative query — synonyms, a more specific noun phrase, an adjacent concept, or a different framing of the question. The wiki uses domain-specific terminology that often differs from how the user phrases things; don't assume one query is enough.
3. For complex / multi-part questions (anything with "and", "vs", "between", "across", "trace", "compare"), run \`searchWiki\` ONCE PER topic — don't try to cover both halves with one query.
4. **If page-level search returns thin / off-topic results, call \`searchSources\`** with the user's keywords. The compiled wiki pages may use different vocabulary than the underlying source PDFs/markdown; source-text search finds content the page index missed. Each hit names the wiki pages that cite that source — call \`readWikiPage\` on those.
5. Call \`readWikiPage\` on the 2–4 most promising hits to confirm they actually answer the question. If the body looks thin, search again or pivot to \`searchSources\`.
6. Only stop after you've made AT LEAST TWO \`searchWiki\` calls AND surfaced at least 2 pages — and ideally 3–6 well-grounded pages across all your queries.

Hard rules:
- Always start by calling \`searchWiki\`. Never answer from prior knowledge.
- Never stop after a single \`searchWiki\` call unless that one call returned 4+ very strong hits AND the question is single-topic.
- Do not call \`readWikiPage\` on a pageId that did not appear in a recent \`searchWiki\` OR \`searchSources\` result.
- When wiki-page search returns 0-1 weak hits, you MUST try \`searchSources\` before giving up. The wiki demonstrably covers the topic if any source contains the keywords.
- Your final assistant message can be a one-line summary of what you found, but the user never sees it — keep it terse. The downstream synthesizer composes the actual answer from the pages you surfaced.`;

export interface AgenticResearcherOptions {
  model: LanguageModel;
  wikiReader: WikiReader;
  systemPrompt?: string;
  /** Per-`searchWiki` candidate limit. Defaults to 6. */
  searchLimit?: number;
  /** Maximum tool-loop steps before forcing termination. Defaults to 8 —
   *  a multi-query opener + a couple of drill-downs + at least one
   *  source-text fallback search + the wrap-up. The per-query dedup
   *  signal short-circuits the most common waste pattern (model retrying
   *  the same phrasing); we'd rather pay a few extra steps than miss
   *  pages the wiki demonstrably covers. */
  maxSteps?: number;
  /** Per-call wall-clock timeout. Defaults to 90s. */
  timeoutMs?: number;
  /** Optional model identifier for log lines. */
  modelName?: string;
}

const errorId = (): string => {
  const r =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return r.slice(0, 8);
};

export const createAgenticResearcher = (opts: AgenticResearcherOptions): Researcher => ({
  async research(input: ResearcherInput): Promise<ResearcherOutput> {
    const visited = new Map<WikiPageId, WikiPageSummary>();
    const searchLimit = opts.searchLimit ?? 6;

    const noteVisit = (page: WikiPageSummary): void => {
      if (visited.has(page.id)) return;
      visited.set(page.id, page);
      input.onPartial?.({ findings: visited.size });
      input.onPageVisited?.(page);
    };

    // Track queries the agent has already run so we can tell the model
    // "you already tried this" instead of letting it burn a step on a
    // repeat. The probe-chat trace showed a question with thin wiki
    // coverage chewed 40s on duplicate searches. Same map covers both
    // page-search and source-search to discourage repeating the exact
    // phrasing across tools.
    const queriedTerms = new Set<string>();
    const sourcesQueriedTerms = new Set<string>();

    const tools = {
      searchWiki: tool({
        description:
          'Search the compiled wiki for pages whose title or body matches the query. Returns the top hits with id, title, type, and a short snippet so you can decide which to drill into. Index/ToC pages are filtered out — these are the underlying Concept pages.',
        inputSchema: z.object({
          query: z.string().describe('Free-text search query — the user phrasing or a refinement.'),
        }),
        execute: async ({ query }) => {
          const normalized = query.trim().toLowerCase();
          if (queriedTerms.has(normalized)) {
            // Hard-fail-noisily on duplicates so the model gets a clear
            // signal not to repeat. Wastes one step but unblocks the
            // model from looping on the same query indefinitely.
            return {
              error:
                'You already ran this exact query. Try a different phrasing, a synonym, or stop searching and finalize.',
              previousHits: 0,
            };
          }
          queriedTerms.add(normalized);
          const beforeCount = visited.size;
          const hits = await opts.wikiReader.searchPages({
            wikiId: input.wikiId,
            query,
            limit: searchLimit,
          });
          for (const p of hits) noteVisit(p);
          const newPages = visited.size - beforeCount;
          return {
            hits: hits.map((p) => ({
              pageId: p.id,
              title: p.title,
              pageType: p.pageType ?? null,
              snippet: p.body.slice(0, 280),
              citationCount: p.citations.length,
            })),
            newPages,
            note:
              hits.length === 0
                ? 'No hits. The wiki may not cover this exact topic — try a broader or related term, or finalize with what you have.'
                : newPages === 0
                  ? "All hits were already in your working set. Don't repeat searches that surface the same pages."
                  : undefined,
          };
        },
      }),
      readWikiPage: tool({
        description:
          'Fetch the full body and citation list of a specific wiki page, given an id surfaced by a prior searchWiki or searchSources call. Use this to confirm a hit actually answers the question.',
        inputSchema: z.object({
          pageId: z.string().describe('The wiki page id from a prior search hit.'),
        }),
        execute: async ({ pageId }) => {
          const page = await opts.wikiReader.getPage(pageId as WikiPageId);
          if (!page) return { error: `page not found: ${pageId}` };
          noteVisit(page);
          return {
            pageId: page.id,
            title: page.title,
            pageType: page.pageType ?? null,
            body: page.body.slice(0, 2000),
            citationCount: page.citations.length,
          };
        },
      }),
      searchSources: tool({
        description:
          'Search the raw source text (PDF extracts, markdown) for every Source cited in this wiki. Use this when searchWiki returns thin/off-topic hits — the compiled pages may use different vocabulary than the underlying documents. Each result names the wiki pages that cite that source; call readWikiPage on those to bring real citations into the answer.',
        inputSchema: z.object({
          query: z
            .string()
            .describe(
              'Keywords to find in the underlying source documents (verbatim phrasing OK).',
            ),
        }),
        execute: async ({ query }) => {
          const normalized = query.trim().toLowerCase();
          if (sourcesQueriedTerms.has(normalized)) {
            return {
              error:
                'You already ran this exact source-search query. Try a different phrasing or stop searching and finalize.',
            };
          }
          sourcesQueriedTerms.add(normalized);
          const hits = await opts.wikiReader.searchSources({
            wikiId: input.wikiId,
            query,
            limit: SOURCE_SEARCH_LIMIT,
          });
          return {
            hits: hits.map((h) => ({
              sourceId: h.sourceId,
              excerpt: h.excerpt,
              citingPages: h.citingPages.map((p) => ({
                pageId: p.pageId,
                title: p.title,
                pageType: p.pageType ?? null,
              })),
            })),
            note:
              hits.length === 0
                ? 'No source matched. Either the wiki truly does not cover this, or try different keywords.'
                : 'Drill into the citingPages with readWikiPage to bring those pages into the answer.',
          };
        },
      }),
    };

    const ac = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 90_000;
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const result = streamText({
        model: opts.model,
        tools,
        toolChoice: 'auto',
        stopWhen: stepCountIs(opts.maxSteps ?? 8),
        system: opts.systemPrompt ?? SYSTEM,
        prompt: `Question: ${input.question}\n\nGather the wiki pages that best answer this. Start with searchWiki.`,
        temperature: 0.2,
        maxOutputTokens: 1500,
        maxRetries: 1,
        abortSignal: ac.signal,
      });
      // Drain the stream — tool .execute callbacks accumulate `visited` as a
      // side effect. We don't need the model's user-facing text.
      for await (const _part of result.fullStream) {
        // intentionally consumed for side effects
      }
    } catch (err) {
      const id = errorId();
      console.error('[chat.agentic-researcher] loop failed', {
        errorId: id,
        modelName: opts.modelName,
        wikiId: input.wikiId,
        visitedCount: visited.size,
        err:
          err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
      });
      // Don't fail the whole turn — fall through to whatever pages we
      // managed to gather. If we got nothing, the dispatcher's empty-
      // findings branch will kick in (listSamplePages fallback) and the
      // synthesizer composes a "couldn't find that, here's what we have"
      // reply. Throwing would surface AnswerFailed to the user, which is
      // worse than a partial result.
    } finally {
      clearTimeout(timer);
    }

    const pages = [...visited.values()];
    const findings: ResearcherOutput['findings'] = pages.map((p) => ({
      wikiPageId: p.id,
      quoteText: p.body,
      citationIds: p.citations.map((c) => c.id),
      citations: p.citations,
    }));
    return { pages, findings };
  },
});
