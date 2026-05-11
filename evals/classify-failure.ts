/**
 * Failure classifier for chat-eval cases.
 *
 * When a chat-eval case fails its rubric, the binary pass/fail tells the
 * reviewer *that* something is wrong. The classifier tells them *why* —
 * which stage of the pipeline dropped the ball. That diagnosis is what
 * makes the eval load-bearing: it points at the next bug, not just at a
 * score.
 *
 * Five classes, ordered cheapest-first so the function returns the FIRST
 * match and the more-expensive probes only run when earlier ones pass:
 *
 *   1. INGESTION_MISS — the gold-truth string doesn't appear in any
 *      source text the api serves for the wiki. Ingestion dropped or
 *      mis-extracted the source PDF (or the gold span is wrong).
 *
 *   2. COMPILE_MISS — the gold string IS in the source text, but no
 *      Citation on any wiki page covers the span where it appears.
 *      The Drafter / Narrator never surfaced it as a claim.
 *
 *   3. RETRIEVAL_MISS — the wiki page that cites the span exists, but
 *      it never appeared in the chat agent's retrieved-pages set for
 *      this turn. The page is in the wiki; the agent's search didn't
 *      surface it.
 *
 *   4. SYNTHESIS_FAIL — the agent retrieved the right page, but the
 *      final answer doesn't reflect it. Probed with an Opus judge call
 *      against the cited page body. Skipped (returns the next-best class)
 *      when no OPEN_ROUTER_API_KEY is in the environment.
 *
 *   5. VERIFIER_FALSE_NEGATIVE — the verifier flagged a citation as
 *      unsupported, but a judge says it's actually supported. Lowest
 *      priority; only fires when lint output is in the probe. Same judge
 *      pattern as SYNTHESIS_FAIL; same env-var gating.
 *
 * If every check passes (i.e. nothing is broken end-to-end for this
 * probe), the function returns `PASS`. This lets the caller use the
 * classifier as a *sanity* probe too — handy for the
 * known-false-positive INGESTION_MISS test inside `run-with-classifier`.
 *
 * The function holds no global state except a per-process source-text
 * cache, keyed by `sourceId`. Caller is responsible for passing the same
 * cache instance across probes when the wikis-under-test share sources.
 */

import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@package/contracts';
import type { FolderId, SourceId, WikiId, WikiPageId } from '@package/contracts/shared';

export type FailureClass =
  | 'INGESTION_MISS'
  | 'COMPILE_MISS'
  | 'RETRIEVAL_MISS'
  | 'SYNTHESIS_FAIL'
  | 'VERIFIER_FALSE_NEGATIVE'
  | 'PASS';

export interface FailureProbe {
  readonly apiUrl: string;
  readonly wikiId: string;
  readonly question: string;
  /** Verbatim text we expect to find SOMEWHERE in the wiki's source corpus. */
  readonly goldSpan?: string;
  /** Optional — when set, narrow the source-text scan to this source. */
  readonly goldSourceId?: string;
  /** Optional — when set, narrow the retrieval check to this page id. */
  readonly goldWikiPageId?: string;
  /** Final answer text the chat produced (flattened prose + artifact text). */
  readonly answer?: string;
  /** Source ids the answer's citations point to. */
  readonly answerSourceIds?: readonly string[];
  /** Wiki page ids the agent retrieved during research. */
  readonly answerWikiPageIds?: readonly string[];
  /**
   * Optional verifier output for the turn (one entry per citation lint
   * decision). When present, drives the VERIFIER_FALSE_NEGATIVE check.
   * Each entry includes the citation's cited text so the judge can rule.
   */
  readonly verifierFindings?: ReadonlyArray<{
    readonly citationId: string;
    readonly verdict: 'supported' | 'unsupported' | 'contradicted';
    readonly claimText: string;
    readonly citedText: string;
  }>;
}

export interface FailureClassification {
  readonly class: FailureClass;
  readonly evidence: string;
  readonly probedAt: string;
  readonly probeLatencyMs: number;
}

/**
 * Caller-provided shared cache. Keyed by `sourceId`; `null` means we
 * already tried to fetch and the source had no text body.
 */
export type SourceTextCache = Map<string, string | null>;

export const createSourceTextCache = (): SourceTextCache => new Map();

const fetchSourceText = async (
  apiUrl: string,
  sourceId: string,
  cache: SourceTextCache,
): Promise<string | null> => {
  const cached = cache.get(sourceId);
  if (cached !== undefined) return cached;
  const resp = await fetch(`${apiUrl}/__source/${sourceId}/text`);
  if (!resp.ok) {
    cache.set(sourceId, null);
    return null;
  }
  const text = await resp.text();
  cache.set(sourceId, text);
  return text;
};

interface PageRow {
  readonly id: string;
  readonly title: string;
  readonly citations: ReadonlyArray<{
    readonly id: string;
    readonly span: {
      readonly sourceId: string;
      readonly byteRange: { start: number; end: number };
    };
  }>;
}

const buildClient = (apiUrl: string): ContractRouterClient<Contract> => {
  const link = new RPCLink({ url: `${apiUrl}/rpc` });
  return createORPCClient(link) as ContractRouterClient<Contract>;
};

const fetchWikiPages = async (apiUrl: string, wikiId: string): Promise<PageRow[]> => {
  // The chat eval already uses oRPC for the same listPages+getPage join —
  // mirror it so the classifier respects the same contract.
  const client = buildClient(apiUrl);
  const list = await client.wiki.listPages({ wikiId: wikiId as WikiId, limit: 100 });
  const pages: PageRow[] = [];
  for (const item of list.items) {
    const page = await client.wiki.getPage({ id: item.id as WikiPageId });
    pages.push({
      id: page.id,
      title: page.title,
      citations: page.citations.map((c) => ({
        id: c.id,
        span: {
          sourceId: c.span.sourceId,
          byteRange: { start: c.span.byteRange.start, end: c.span.byteRange.end },
        },
      })),
    });
  }
  return pages;
};

const fetchSourceIdsForWiki = async (apiUrl: string, wikiId: string): Promise<string[]> => {
  // Go wiki -> folderId -> listSources(folderId); both are oRPC GETs.
  const client = buildClient(apiUrl);
  const wiki = await client.wiki.getWiki({ id: wikiId as WikiId });
  const sources = await client.ingestion.listSources({
    folderId: wiki.folderId as FolderId,
    limit: 100,
  });
  return sources.items.map((s) => s.id as SourceId);
};

interface JudgeOutcome {
  readonly verdict: 'supported' | 'unsupported';
  readonly reason: string;
}

/**
 * Minimal OpenRouter-via-fetch judge call. Mirrors the
 * `AnthropicVerifier` pattern in `packages/domains/verification/` but
 * trims it to plain HTTP so eval infra carries no domain dep. Returns
 * `null` when the env var is missing — caller treats that as "skip".
 */
const judgeSupports = async (
  question: string,
  emittedAnswer: string,
  referenceText: string,
): Promise<JudgeOutcome | null> => {
  const apiKey = process.env.OPEN_ROUTER_API_KEY;
  if (!apiKey) return null;
  const system =
    'You are a strict judge. You are shown a question, an answer a chat system produced, and a reference passage from a wiki page the chat agent had in its context. Decide whether the ANSWER reflects the information in the REFERENCE that would answer the QUESTION. Reply with JSON: {"verdict":"supported"|"unsupported","reason":"..."} — keep reason under 200 chars.';
  const user = `Question:\n${question}\n\nAnswer the chat produced:\n${emittedAnswer}\n\nReference passage:\n${referenceText.slice(0, 6000)}`;
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-opus-4-7',
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!resp.ok) {
    return { verdict: 'supported', reason: `judge-call-failed:${resp.status}` };
  }
  const body = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) return { verdict: 'supported', reason: 'empty-judge-response' };
  try {
    const parsed = JSON.parse(content) as JudgeOutcome;
    if (parsed.verdict === 'supported' || parsed.verdict === 'unsupported') {
      return parsed;
    }
    return { verdict: 'supported', reason: 'unparsed-verdict' };
  } catch {
    return { verdict: 'supported', reason: 'unparsed-json' };
  }
};

const judgeCitationFits = async (
  claimText: string,
  citedText: string,
): Promise<JudgeOutcome | null> => {
  const apiKey = process.env.OPEN_ROUTER_API_KEY;
  if (!apiKey) return null;
  const system =
    'You are a strict citation judge. You see a CLAIM and a CITED slice. Decide if the cited slice substantiates the claim. Reply JSON: {"verdict":"supported"|"unsupported","reason":"..."}. Reason under 200 chars.';
  const user = `CLAIM:\n${claimText}\n\nCITED:\n${citedText.slice(0, 6000)}`;
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'anthropic/claude-opus-4-7',
      temperature: 0,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!resp.ok) return { verdict: 'unsupported', reason: `judge-call-failed:${resp.status}` };
  const body = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) return { verdict: 'unsupported', reason: 'empty-judge-response' };
  try {
    const parsed = JSON.parse(content) as JudgeOutcome;
    if (parsed.verdict === 'supported' || parsed.verdict === 'unsupported') return parsed;
    return { verdict: 'unsupported', reason: 'unparsed-verdict' };
  } catch {
    return { verdict: 'unsupported', reason: 'unparsed-json' };
  }
};

/** Case-insensitive substring search over a haystack. */
const containsCi = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

export interface ClassifyOptions {
  readonly sourceTextCache?: SourceTextCache;
  /** Wall-clock budget for a single probe; defaults to 30s per spec. */
  readonly timeoutMs?: number;
}

export const classifyFailure = async (
  probe: FailureProbe,
  options: ClassifyOptions = {},
): Promise<FailureClassification> => {
  const probedAt = new Date().toISOString();
  const started = Date.now();
  const cache = options.sourceTextCache ?? createSourceTextCache();
  const budget = options.timeoutMs ?? 30_000;
  const deadline = started + budget;
  const timeLeft = (): number => deadline - Date.now();

  const finish = (cls: FailureClass, evidence: string): FailureClassification => ({
    class: cls,
    evidence,
    probedAt,
    probeLatencyMs: Date.now() - started,
  });

  // ──────────── 1. INGESTION_MISS ────────────
  // Gold span exists somewhere in the source corpus the api serves for this
  // wiki? If not, ingestion is at fault — no downstream stage could have
  // surfaced text that isn't there.
  if (probe.goldSpan && probe.goldSpan.length > 0) {
    const sourceIds = probe.goldSourceId
      ? [probe.goldSourceId]
      : await fetchSourceIdsForWiki(probe.apiUrl, probe.wikiId);
    let foundInSourceId: string | undefined;
    for (const sid of sourceIds) {
      if (timeLeft() <= 0) break;
      const text = await fetchSourceText(probe.apiUrl, sid, cache);
      if (text !== null && containsCi(text, probe.goldSpan)) {
        foundInSourceId = sid;
        break;
      }
    }
    if (!foundInSourceId) {
      return finish(
        'INGESTION_MISS',
        `gold-span (${probe.goldSpan.slice(0, 80)}…) not found in any of the ${sourceIds.length} source(s) for wiki ${probe.wikiId}`,
      );
    }

    // ──────────── 2. COMPILE_MISS ────────────
    // Gold span IS in source text — is there a Citation pointing at the
    // byte range where it appears? If no citation overlaps the gold-span
    // region in the source we found it in, the Drafter / Narrator never
    // surfaced it as a claim.
    if (timeLeft() > 0) {
      const sourceText = (await fetchSourceText(probe.apiUrl, foundInSourceId, cache)) ?? '';
      const goldIdx = sourceText.toLowerCase().indexOf(probe.goldSpan.toLowerCase());
      const goldEnd = goldIdx + probe.goldSpan.length;
      const pages = await fetchWikiPages(probe.apiUrl, probe.wikiId);
      let citingPageId: string | undefined;
      for (const page of pages) {
        for (const cit of page.citations) {
          if (cit.span.sourceId !== foundInSourceId) continue;
          const a = cit.span.byteRange.start;
          const b = cit.span.byteRange.end;
          // Overlap iff [a,b) intersects [goldIdx, goldEnd)
          if (a < goldEnd && b > goldIdx) {
            citingPageId = page.id;
            break;
          }
        }
        if (citingPageId) break;
      }
      if (!citingPageId) {
        return finish(
          'COMPILE_MISS',
          `gold-span lives in source ${foundInSourceId} at bytes [${goldIdx},${goldEnd}) but no wiki page cites a range covering it`,
        );
      }

      // ──────────── 3. RETRIEVAL_MISS ────────────
      // Wiki page that cites the gold span exists — did the chat agent
      // surface it during research?
      const retrieved = new Set(probe.answerWikiPageIds ?? []);
      const expectedPageId = probe.goldWikiPageId ?? citingPageId;
      if (retrieved.size > 0 && !retrieved.has(expectedPageId)) {
        return finish(
          'RETRIEVAL_MISS',
          `wiki page ${expectedPageId} cites the gold span but was not in the ${retrieved.size} retrieved page(s) for the turn`,
        );
      }

      // ──────────── 4. SYNTHESIS_FAIL ────────────
      // The right page was retrieved but the emitted answer doesn't
      // reflect the cited content. Judge-model call against the cited
      // slice. Skipped (falls through to PASS) when no judge key.
      if (probe.answer && probe.answer.length > 0 && timeLeft() > 0) {
        const sliceStart = Math.max(0, goldIdx - 200);
        const sliceEnd = Math.min(sourceText.length, goldEnd + 200);
        const reference = sourceText.slice(sliceStart, sliceEnd);
        const judgment = await judgeSupports(probe.question, probe.answer, reference);
        if (judgment !== null && judgment.verdict === 'unsupported') {
          return finish(
            'SYNTHESIS_FAIL',
            `judge: answer does not reflect cited reference (${judgment.reason})`,
          );
        }
      }
    }
  }

  // ──────────── 5. VERIFIER_FALSE_NEGATIVE ────────────
  // For any verifier finding marked NOT supported, ask the judge whether
  // the cited slice actually substantiates the claim. If the judge says
  // yes, the verifier was wrong.
  if (probe.verifierFindings && probe.verifierFindings.length > 0 && timeLeft() > 0) {
    for (const f of probe.verifierFindings) {
      if (f.verdict === 'supported') continue;
      if (timeLeft() <= 0) break;
      const j = await judgeCitationFits(f.claimText, f.citedText);
      if (j !== null && j.verdict === 'supported') {
        return finish(
          'VERIFIER_FALSE_NEGATIVE',
          `verifier said ${f.verdict} on citation ${f.citationId} but judge says supported (${j.reason})`,
        );
      }
    }
  }

  return finish(
    'PASS',
    'every staged probe passed — ingestion has the gold span, a wiki page cites it, the agent retrieved it, and the answer reflects it',
  );
};
