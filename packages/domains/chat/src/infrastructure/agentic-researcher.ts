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

/**
 * "Really try hard." A ToolLoopAgent-style researcher built on
 * `streamText({ tools, stopWhen })`. The model decides what to search
 * for, drills into promising hits, and may follow up with a refined
 * query before declaring it has enough context.
 *
 * Two tools, no source-slice reads:
 *   - `searchWiki({ query })` — one round of token-overlap search
 *   - `readWikiPage({ pageId })` — full body + citation list for a hit
 *
 * Source-slice reads are NOT exposed to the agent: the synthesizer's
 * `expandWithSourceEvidence` step (in `apps/api/src/build-chat-context.ts`)
 * already inlines per-citation source excerpts into each finding's body
 * before the synth prompt is built. Adding a source-read tool here would
 * just duplicate that work and bloat the loop.
 *
 * Loop budget: the agent stops after `maxSteps` generations (default 6 —
 * roughly enough for two query attempts + a few drill-downs + the final
 * "I'm done" message). The output text the model produces during the
 * loop is discarded — the synthesizer composes the user-facing answer
 * downstream from the aggregated findings.
 *
 * Page deduplication: the same wiki page may be surfaced multiple times
 * (initial search + a later drill-down). We dedupe by id and only fire
 * `onPageVisited` the first time. The synthesizer dedupes findings by
 * page id internally via the citation-id set, but emitting one finding
 * per unique page keeps the synth prompt smaller.
 */
const SYSTEM = `You are Researcher. Your job is to gather the wiki pages that best answer the user's question, so that another agent can compose the final answer.

Workflow:
1. Call \`searchWiki\` with the user's exact phrasing first. Read the titles and snippets that come back.
2. If the initial hits look weak — generic, off-topic, or fewer than 2 — call \`searchWiki\` again with a refined query: try synonyms, a more specific noun phrase, or a related concept the user is likely after.
3. Call \`readWikiPage\` on the 2–4 most promising hits to confirm they actually answer the question.
4. Stop as soon as you have 2–4 well-grounded pages. Do not over-search.

Hard rules:
- Always start by calling \`searchWiki\`. Never answer from prior knowledge.
- Do not call \`readWikiPage\` on a pageId that did not appear in a recent \`searchWiki\` result.
- Your final assistant message can be a one-line summary of what you found, but the user never sees it — keep it terse. The downstream synthesizer composes the actual answer from the pages you surfaced.`;

export interface AgenticResearcherOptions {
  model: LanguageModel;
  wikiReader: WikiReader;
  systemPrompt?: string;
  /** Per-`searchWiki` candidate limit. Defaults to 6. */
  searchLimit?: number;
  /** Maximum tool-loop steps before forcing termination. Defaults to 6. */
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

    const tools = {
      searchWiki: tool({
        description:
          'Search the compiled wiki for pages whose title or body matches the query. Returns the top hits with id, title, type, and a short snippet so you can decide which to drill into.',
        inputSchema: z.object({
          query: z.string().describe('Free-text search query — the user phrasing or a refinement.'),
        }),
        execute: async ({ query }) => {
          const hits = await opts.wikiReader.searchPages({
            wikiId: input.wikiId,
            query,
            limit: searchLimit,
          });
          for (const p of hits) noteVisit(p);
          return {
            hits: hits.map((p) => ({
              pageId: p.id,
              title: p.title,
              pageType: p.pageType ?? null,
              snippet: p.body.slice(0, 280),
              citationCount: p.citations.length,
            })),
          };
        },
      }),
      readWikiPage: tool({
        description:
          'Fetch the full body and citation list of a specific wiki page, given an id surfaced by a prior searchWiki call. Use this to confirm a hit actually answers the question.',
        inputSchema: z.object({
          pageId: z.string().describe('The wiki page id from a prior searchWiki hit.'),
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
    };

    const ac = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 90_000;
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const result = streamText({
        model: opts.model,
        tools,
        toolChoice: 'auto',
        stopWhen: stepCountIs(opts.maxSteps ?? 6),
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
