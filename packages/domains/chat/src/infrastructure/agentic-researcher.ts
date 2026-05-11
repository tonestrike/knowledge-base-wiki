import type { WikiPageId } from '@package/contracts/shared';
import { type LanguageModel, stepCountIs, streamText, tool } from 'ai';
import { z } from 'zod';
import type {
  Researcher,
  ResearcherInput,
  ResearcherOutput,
  WikiMeta,
  WikiPageSummary,
  WikiReader,
} from '../application/ports.ts';

const SOURCE_SEARCH_LIMIT = 6;
const TYPE_LIST_LIMIT = 12;

/**
 * # AgenticResearcher — the chat agent loop
 *
 * Stage 1 of the chat pipeline. Given a user's question and a wiki id,
 * surfaces the pages relevant to answer it. Built on
 * `streamText({ tools, stopWhen: stepCountIs(8) })`: the model
 * decides what to search for, drills into promising hits, follows up
 * with refined queries, then stops when it has enough context.
 *
 * ## The four tools, ordered by intended use
 *
 *   - `listPagesByType({ pageType })` — enumerate every Concept page
 *     of a given type (browse the wiki's "Opportunity" section by
 *     name). The agent's first tool when the user's question maps to
 *     one of the wiki's PageType names. Beats keyword-guessing.
 *
 *   - `searchWiki({ query })` — token-overlap search over page title +
 *     body. Used for keyword-shaped queries or as a follow-up after
 *     listPagesByType.
 *
 *   - `readWikiPage({ pageId })` — fetch a single page's full body +
 *     citation list. The agent calls this on the 2-4 most promising
 *     hits from list/search calls to confirm they actually answer.
 *
 *   - `searchSources({ query })` — token-overlap search over the raw
 *     source documents (extracted PDF text, markdown). Returns the
 *     wiki pages that cite each matching source. Used when page-level
 *     search misses content the user's phrasing should plausibly hit
 *     — the compiled pages may use different vocabulary than the
 *     source documents.
 *
 * ## Wiki-taxonomy injection
 *
 * Before the loop starts, `getWikiMeta(wikiId)` fetches the wiki's
 * PageType list + perspective + folder name. `buildSystem(meta)`
 * injects a "Wiki taxonomy" block into the system prompt naming the
 * actual sections of THIS wiki. That's how the agent knows "business
 * ideas" → Opportunity, "what could go wrong" → Risk, etc.
 *
 * ## Deduplication
 *
 * The same wiki page can be surfaced by multiple tools (initial
 * listPagesByType + later searchWiki + a searchSources citing page).
 * `noteVisit` dedupes by page id and only fires `onPageVisited` the
 * first time so the dispatcher emits exactly one WikiPageRetrieved
 * event per unique page. The final findings array has one entry per
 * unique page surfaced.
 *
 * ## Error policy
 *
 * The loop's own catch swallows model failures and returns whatever
 * pages we managed to gather. Throwing here would surface
 * AnswerFailed to the user; the empty-findings branch downstream
 * composes a graceful "couldn't match, here's what we have" reply
 * from listSamplePages instead.
 */
const SYSTEM_BASE = `You are Researcher. Your job is to find AS MANY relevant wiki pages as possible so that another agent can compose a thorough, well-cited answer. You have four tools — use them all when appropriate.

Tools:
- \`searchWiki\` — token-overlap search across page titles + bodies.
- \`readWikiPage\` — fetch a page's full body + citations by id.
- \`searchSources\` — token-overlap search over the raw source documents
  (PDFs / markdown the wiki was compiled from). Returns the wiki pages
  that cite each matching source.
- \`listPagesByType\` — enumerate every Concept page of a given PageType
  (i.e. browse a section). Use this when the user's question maps to
  one of the wiki's sections (see "Wiki taxonomy" below).

Workflow:
1. **First read the "Wiki taxonomy" block below**. If the user's question
   plausibly maps to one of the listed PageTypes (e.g. they ask about
   "business ideas" and an "Opportunity" PageType exists, or about
   "what could go wrong" and a "Risk" PageType exists), call
   \`listPagesByType\` for that PageType FIRST. Browsing a section by
   name beats keyword-guessing.
2. Call \`searchWiki\` with the user's exact phrasing. Read every title
   and snippet that comes back.
3. Call \`searchWiki\` AGAIN with at least one alternative query — a
   synonym, a more specific noun phrase, or a different framing. Don't
   assume one query is enough; wiki terminology often differs from how
   users phrase things.
4. For complex / multi-part questions (anything with "and", "vs",
   "between", "across", "trace", "compare"), run \`searchWiki\` ONCE
   PER topic — don't cover both halves with one query.
5. If page-level search is thin, call \`searchSources\` with the user's
   keywords. The compiled wiki pages may use different vocabulary than
   the underlying PDFs; source-text search finds content the page index
   missed. Drill into the citing pages it returns via \`readWikiPage\`.
6. Call \`readWikiPage\` on the 2–4 most promising hits to confirm they
   answer the question.
7. Stop after you've surfaced at least 2-3 well-grounded pages.

Hard rules:
- Never answer from prior knowledge. Always ground in wiki content.
- If the user's question maps to a PageType in the taxonomy, you MUST
  call \`listPagesByType\` before declaring there's nothing on the
  topic. "No findings on opportunities" while an Opportunity PageType
  exists in the taxonomy is a failure mode this rule prevents.
- Do not call \`readWikiPage\` on a pageId that didn't appear in a
  recent search/list call.
- When wiki-page search returns 0-1 weak hits, you MUST try
  \`searchSources\` AND \`listPagesByType\` (against any plausibly
  matching PageType) before giving up.
- Your final assistant message is invisible to the user — the
  downstream synthesizer composes the actual answer from the pages you
  surfaced. Keep it terse.`;

const buildSystem = (meta: WikiMeta | null, override?: string): string => {
  if (override) return override;
  if (!meta || meta.pageTypes.length === 0) return SYSTEM_BASE;
  const lines: string[] = ['', 'Wiki taxonomy (THIS wiki):'];
  if (meta.folderName) lines.push(`- Folder: ${meta.folderName}`);
  if (meta.perspective) {
    const oneLine = meta.perspective.split('\n')[0]?.slice(0, 240) ?? '';
    lines.push(`- Perspective the wiki was compiled under: ${oneLine}`);
  }
  lines.push('- PageTypes (sections you can browse with listPagesByType):');
  for (const pt of meta.pageTypes) {
    lines.push(`    • ${pt.name} — ${pt.description.slice(0, 140)}`);
  }
  lines.push('');
  lines.push(
    'When the user asks about a topic that maps to one of these PageType names (semantically — "business ideas" → Opportunity, "what could go wrong" → Risk, "how-to" → Skill, etc.), call listPagesByType FIRST.',
  );
  return `${SYSTEM_BASE}\n${lines.join('\n')}`;
};

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
    // `visited` is the canonical working set the loop builds up. Each
    // tool's `execute` callback adds pages via `noteVisit` below; at
    // the end of the run we return [...visited.values()] as the
    // research output. Order doesn't matter — the synth treats
    // findings as a set.
    const visited = new Map<WikiPageId, WikiPageSummary>();
    const searchLimit = opts.searchLimit ?? 6;

    // Called by every tool's execute() when a page enters the working
    // set. Deduplicates by page id (the same page is often surfaced
    // by multiple tools — initial listPagesByType + a later
    // searchWiki + the citing-pages of a searchSources hit).
    //
    // The two callbacks fire the FIRST time we see a page only:
    //   - `onPartial` → emits ResearchProgress to the SSE tape (UI
    //     spinner / count)
    //   - `onPageVisited` → emits one WikiPageRetrieved event with
    //     title + pageType, which the chat dock renders as a
    //     "Reading X" line in the reasoning bubble
    const noteVisit = (page: WikiPageSummary): void => {
      if (visited.has(page.id)) return;
      visited.set(page.id, page);
      input.onPartial?.({ findings: visited.size });
      input.onPageVisited?.(page);
    };

    // Per-tool seen-set used to short-circuit the model's habit of
    // repeating the same query verbatim. Each tool's execute() checks
    // its own set first; on a repeat it returns an `error: "you
    // already ran this"` shape that costs ONE wasted step but breaks
    // the loop pattern. Separate sets per tool (queriedTerms /
    // sourcesQueriedTerms / typedListed) so a searchWiki call doesn't
    // prevent a same-phrase searchSources call — those are genuinely
    // different probes against different indexes.
    const queriedTerms = new Set<string>();
    const sourcesQueriedTerms = new Set<string>();
    const typedListed = new Set<string>();

    // Fetch the wiki's taxonomy + perspective so the agent's system
    // prompt can name the actual section vocabulary. Best-effort —
    // if the read fails (or the reader doesn't implement it) we fall
    // back to the schema-less system prompt.
    let meta: WikiMeta | null = null;
    try {
      meta = await opts.wikiReader.getWikiMeta(input.wikiId);
    } catch (metaErr) {
      console.warn(
        '[chat.agentic-researcher] getWikiMeta failed; running without taxonomy',
        metaErr instanceof Error ? metaErr.message : metaErr,
      );
    }

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
      listPagesByType: tool({
        description:
          "Enumerate every Concept page in the wiki under a given PageType (i.e. browse a section by name). Use this when the user's question maps to one of the PageType names in the wiki's taxonomy — e.g. they ask about 'business ideas' and an 'Opportunity' PageType exists. Returns page ids + titles + short snippets; drill into specific pages with readWikiPage. The pageType must EXACTLY match one of the names in the taxonomy block; case-sensitive.",
        inputSchema: z.object({
          pageType: z
            .string()
            .describe('Exact PageType name from the Wiki taxonomy block (case-sensitive).'),
        }),
        execute: async ({ pageType }) => {
          const normalized = pageType.trim();
          if (typedListed.has(normalized)) {
            return {
              error: `You already listed pages for "${normalized}". Move on to readWikiPage on the ones you haven't read, or try a different PageType.`,
            };
          }
          typedListed.add(normalized);
          // Guard: warn if the agent asked for a pageType the wiki
          // doesn't have. The wikiReader will return [] anyway, but
          // a noisy error helps the model pick a different one quickly.
          if (meta && !meta.pageTypes.some((pt) => pt.name === normalized)) {
            return {
              error: `Unknown PageType "${normalized}". The wiki's PageTypes are: ${meta.pageTypes.map((pt) => pt.name).join(', ')}.`,
            };
          }
          const beforeCount = visited.size;
          const hits = await opts.wikiReader.listPagesByType({
            wikiId: input.wikiId,
            pageType: normalized,
            limit: TYPE_LIST_LIMIT,
          });
          for (const p of hits) noteVisit(p);
          const newPages = visited.size - beforeCount;
          return {
            pageType: normalized,
            count: hits.length,
            pages: hits.map((p) => ({
              pageId: p.id,
              title: p.title,
              snippet: p.body.slice(0, 200),
              citationCount: p.citations.length,
            })),
            newPages,
            note:
              hits.length === 0
                ? `No Concept pages in section "${normalized}". The taxonomy lists this PageType but no pages were compiled into it.`
                : 'Use readWikiPage on the most relevant entries to bring full bodies + citations into the answer.',
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
        system: buildSystem(meta, opts.systemPrompt),
        prompt: `Question: ${input.question}\n\nGather the wiki pages that best answer this. If the question maps to one of the PageTypes in the Wiki taxonomy block, call listPagesByType FIRST. Otherwise start with searchWiki.`,
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
