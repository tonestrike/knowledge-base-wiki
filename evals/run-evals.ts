#!/usr/bin/env bun
/**
 * Anthropic-papers chat-eval runner.
 *
 * Drives `evals/anthropic-papers-cases.ts` against a running api worker
 * (default https://api.tenex.localhost:1355). Each case opens a fresh
 * Conversation, asks the question, drains the SSE answer-event stream,
 * and scores the result against the case's expected criteria. Writes a
 * markdown report to stdout (and to `evals/results-<timestamp>.md` when
 * `--write` is passed).
 *
 * Why this exists: the agentic researcher's behavior is a property of
 * the LLM tool-loop — unit tests can stub the model, but only a real
 * end-to-end run against the compiled wiki proves the agent actually
 * surfaces the right pages, grounds against source text, and emits the
 * artifact kinds the synth prompt promises. Run after any change to the
 * agent prompt, the synth prompt, the artifact registry, or the wiki
 * compile pipeline.
 *
 * Usage:
 *   bun run evals                                # auto-pick newest wiki
 *   bun run evals -- --wikiId=<uuid>             # pin to a specific wiki
 *   bun run evals -- --case=many-shot-headline-number   # one case only
 *   bun run evals -- --apiUrl=https://api.example.com   # remote api
 *   bun run evals -- --write                     # also write a md report
 *
 * The runner makes ZERO assumptions about which wiki is loaded — it
 * targets the most-recently-compiled one by default. Run after a fresh
 * compile of the Anthropic-papers Drive folder to get meaningful scores.
 */

import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@package/contracts';
import type { AnswerEvent } from '@package/contracts/chat';
import type { ConversationId, TurnId, WikiId } from '@package/contracts/shared';
import { ANTHROPIC_PAPERS_CASES, type EvalCase } from './anthropic-papers-cases.ts';

interface CliArgs {
  wikiId?: string;
  apiUrl: string;
  caseId?: string;
  write: boolean;
  perCaseTimeoutMs: number;
}

const parseArgs = (argv: string[]): CliArgs => {
  const out: CliArgs = {
    apiUrl: 'https://api.tenex.localhost:1355',
    write: false,
    perCaseTimeoutMs: 180_000,
  };
  for (const arg of argv) {
    if (arg === '--write') out.write = true;
    else if (arg.startsWith('--apiUrl=')) out.apiUrl = arg.slice('--apiUrl='.length);
    else if (arg.startsWith('--wikiId=')) out.wikiId = arg.slice('--wikiId='.length);
    else if (arg.startsWith('--case=')) out.caseId = arg.slice('--case='.length);
    else if (arg.startsWith('--timeoutMs='))
      out.perCaseTimeoutMs = Number(arg.slice('--timeoutMs='.length));
  }
  return out;
};

interface CaseResult {
  case: EvalCase;
  durationMs: number;
  events: AnswerEvent[];
  retrievedTitles: string[];
  answerText: string;
  citationLabels: string[];
  artifactKinds: string[];
  scores: ReturnType<typeof scoreCase>;
  failure?: string;
}

const scoreCase = (
  c: EvalCase,
  retrievedTitles: string[],
  answerText: string,
  citationLabels: string[],
  artifactKinds: string[],
): {
  retrieval: { passed: number; required: number; missing: string[] };
  answer: { passed: number; required: number; missing: string[] };
  artifacts: { passed: number; required: number; missing: string[] };
  citations: { ok: boolean; got: number; required: number };
  sources: { passed: number; required: number; missing: string[] } | null;
  overall: 'pass' | 'partial' | 'fail';
} => {
  const lowerTitles = retrievedTitles.map((t) => t.toLowerCase());
  const retrievalMissing = c.expectedPageTitleFragments.filter(
    (frag) => !lowerTitles.some((t) => t.includes(frag.toLowerCase())),
  );
  const retrievalPassed = c.expectedPageTitleFragments.length - retrievalMissing.length;

  const lowerAnswer = answerText.toLowerCase();
  const answerMissing = c.expectedAnswerSubstrings.filter(
    (s) => !lowerAnswer.includes(s.toLowerCase()),
  );
  const answerPassed = c.expectedAnswerSubstrings.length - answerMissing.length;

  const artifactMissing = c.expectedArtifactKinds.filter((k) => !artifactKinds.includes(k));
  const artifactPassed = c.expectedArtifactKinds.length - artifactMissing.length;

  const citationsOk = citationLabels.length >= c.minCitationCount;

  let sources: { passed: number; required: number; missing: string[] } | null = null;
  if (c.expectedSourceFilenameFragments && c.expectedSourceFilenameFragments.length > 0) {
    const lowerLabels = citationLabels.map((l) => l.toLowerCase());
    const missing = c.expectedSourceFilenameFragments.filter(
      (frag) => !lowerLabels.some((l) => l.includes(frag.toLowerCase())),
    );
    sources = {
      passed: c.expectedSourceFilenameFragments.length - missing.length,
      required: c.expectedSourceFilenameFragments.length,
      missing,
    };
  }

  // overall = pass when EVERY required check is fully satisfied; partial
  // when some signal (any retrieval/answer/artifact match, or citations)
  // came through but at least one criterion failed; fail otherwise.
  const fullyPassed =
    retrievalMissing.length === 0 &&
    answerMissing.length === 0 &&
    artifactMissing.length === 0 &&
    citationsOk &&
    (sources === null || sources.missing.length === 0);
  const anySignal =
    retrievalPassed > 0 || answerPassed > 0 || artifactPassed > 0 || citationLabels.length > 0;
  const overall: 'pass' | 'partial' | 'fail' = fullyPassed
    ? 'pass'
    : anySignal
      ? 'partial'
      : 'fail';

  return {
    retrieval: {
      passed: retrievalPassed,
      required: c.expectedPageTitleFragments.length,
      missing: retrievalMissing,
    },
    answer: {
      passed: answerPassed,
      required: c.expectedAnswerSubstrings.length,
      missing: answerMissing,
    },
    artifacts: {
      passed: artifactPassed,
      required: c.expectedArtifactKinds.length,
      missing: artifactMissing,
    },
    citations: { ok: citationsOk, got: citationLabels.length, required: c.minCitationCount },
    sources,
    overall,
  };
};

/** Flatten an answer's segments into a single plain-text string the
 *  scorer can scan for `expectedAnswerSubstrings`. Mirrors the chat
 *  domain's `flattenAnswer` helper but kept inline so the eval runner
 *  has no domain-package dep. */
const flattenAnswer = (events: AnswerEvent[]): string => {
  const parts: string[] = [];
  // Concatenate prose deltas in order — that's the streaming source of
  // truth. AnswerSegment(prose) only fires once the prose run closes
  // and may duplicate text already streamed via deltas.
  const deltaText = new Map<number, string>();
  for (const e of events) {
    if (e.kind === 'AnswerProseDelta') {
      deltaText.set(e.segmentIndex, (deltaText.get(e.segmentIndex) ?? '') + e.textDelta);
    }
  }
  // Walk segments in index order so prose + artifacts interleave correctly.
  const segByIndex = new Map<number, AnswerEvent>();
  for (const e of events) {
    if (e.kind === 'AnswerSegment') segByIndex.set(e.index, e);
  }
  const indices = [...new Set([...deltaText.keys(), ...segByIndex.keys()])].sort((a, b) => a - b);
  for (const idx of indices) {
    const txt = deltaText.get(idx);
    if (txt && txt.length > 0) {
      parts.push(txt);
      continue;
    }
    const seg = segByIndex.get(idx);
    if (!seg || seg.kind !== 'AnswerSegment') continue;
    const s = seg.segment;
    if (s.kind === 'prose') parts.push(s.text);
    else if (s.kind === 'citation') parts.push(`[${s.citation.label}]`);
    else {
      // Flatten the artifact's user-visible text so scorer substring
      // matches catch facts that landed in artifacts (KeyMetric values,
      // Quote text, ComparisonTable cells, etc.).
      const a = s.artifact;
      const props = a.props as Record<string, unknown>;
      switch (a.kind) {
        case 'Quote':
          parts.push(String(props.text ?? ''));
          break;
        case 'KeyMetric':
          parts.push(`${props.label} ${props.value}`);
          break;
        case 'Markdown':
          parts.push(String(props.body ?? ''));
          break;
        case 'CodeBlock':
          parts.push(String(props.source ?? ''));
          break;
        case 'ComparisonTable': {
          const cols = (props.columns as string[]) ?? [];
          const rows = (props.rows as Array<{ cells: Array<{ value: string }> }>) ?? [];
          parts.push(cols.join(' '));
          for (const row of rows) parts.push(row.cells.map((c) => c.value).join(' '));
          break;
        }
        case 'Timeline': {
          const events = (props.events as Array<{ at: string; label: string }>) ?? [];
          for (const ev of events) parts.push(`${ev.at} ${ev.label}`);
          break;
        }
        case 'BarChart':
        case 'LineChart':
          parts.push(`${props.xLabel} ${props.yLabel}`);
          break;
      }
    }
  }
  return parts.join(' ');
};

const runOneCase = async (
  client: ContractRouterClient<Contract>,
  wikiId: WikiId,
  c: EvalCase,
  timeoutMs: number,
): Promise<CaseResult> => {
  const t0 = Date.now();
  const events: AnswerEvent[] = [];
  const retrievedTitles: string[] = [];
  const citationLabels: string[] = [];
  const artifactKinds: string[] = [];
  let failure: string | undefined;

  try {
    const conv = await client.chat.openConversation({ wikiId });
    const turn = await client.chat.ask({
      conversationId: conv.conversationId as ConversationId,
      question: c.question,
    });
    const turnId = turn.turnId as TurnId;

    // Race the SSE stream against a per-case deadline so a hung run
    // doesn't pin the whole eval suite.
    const deadline = Date.now() + timeoutMs;
    const stream = client.chat.streamAnswer({ turnId });
    for await (const e of stream) {
      events.push(e);
      if (e.kind === 'WikiPageRetrieved') retrievedTitles.push(e.title);
      else if (e.kind === 'AnswerSegment') {
        const s = e.segment;
        if (s.kind === 'citation') citationLabels.push(s.citation.label);
        else if (s.kind === 'artifact') {
          artifactKinds.push(s.artifact.kind);
          for (const cit of s.artifact.citations) citationLabels.push(cit.label);
        }
      } else if (e.kind === 'AnswerFailed') {
        failure = e.message;
      }
      if (e.kind === 'AnswerFinished' || e.kind === 'AnswerFailed') break;
      if (Date.now() > deadline) {
        failure = `case timed out after ${timeoutMs}ms`;
        break;
      }
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }

  const answerText = flattenAnswer(events);
  const scores = scoreCase(c, retrievedTitles, answerText, citationLabels, artifactKinds);
  return {
    case: c,
    durationMs: Date.now() - t0,
    events,
    retrievedTitles,
    answerText,
    citationLabels,
    artifactKinds,
    scores,
    failure,
  };
};

const verdictBadge = (v: 'pass' | 'partial' | 'fail'): string =>
  v === 'pass' ? '✅ pass' : v === 'partial' ? '⚠️  partial' : '❌ fail';

const renderReport = (
  results: CaseResult[],
  ctx: { wikiId: string; apiUrl: string; startedAt: string },
): string => {
  const lines: string[] = [];
  lines.push('# Anthropic-papers chat evals');
  lines.push('');
  lines.push(`- **API**: \`${ctx.apiUrl}\``);
  lines.push(`- **Wiki**: \`${ctx.wikiId}\``);
  lines.push(`- **Started**: ${ctx.startedAt}`);
  lines.push(`- **Cases**: ${results.length}`);
  const counts = { pass: 0, partial: 0, fail: 0 };
  for (const r of results) counts[r.scores.overall] += 1;
  lines.push(
    `- **Verdicts**: ${counts.pass} pass · ${counts.partial} partial · ${counts.fail} fail`,
  );
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Case | Verdict | Retrieval | Answer | Artifacts | Citations | Sources | Time |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    const s = r.scores;
    const sources = s.sources ? `${s.sources.passed}/${s.sources.required}` : '–';
    lines.push(
      `| \`${r.case.id}\` | ${verdictBadge(s.overall)} | ${s.retrieval.passed}/${s.retrieval.required} | ${s.answer.passed}/${s.answer.required} | ${s.artifacts.passed}/${s.artifacts.required} | ${s.citations.got}≥${s.citations.required} | ${sources} | ${(r.durationMs / 1000).toFixed(1)}s |`,
    );
  }
  lines.push('');
  lines.push('## Per-case detail');
  for (const r of results) {
    const s = r.scores;
    lines.push('');
    lines.push(`### ${verdictBadge(s.overall)} \`${r.case.id}\``);
    lines.push('');
    lines.push(`> ${r.case.question}`);
    lines.push('');
    lines.push(`*${r.case.rationale}*`);
    lines.push('');
    if (r.failure) {
      lines.push(`- **Failure**: ${r.failure}`);
    }
    lines.push(
      `- Retrieved pages (${r.retrievedTitles.length}): ${r.retrievedTitles.map((t) => `\`${t}\``).join(', ') || '_none_'}`,
    );
    if (s.retrieval.missing.length > 0) {
      lines.push(
        `  - ⚠ missing fragments: ${s.retrieval.missing.map((f) => `\`${f}\``).join(', ')}`,
      );
    }
    if (s.answer.missing.length > 0) {
      lines.push(
        `- Answer-text gaps (${s.answer.missing.length}): ${s.answer.missing.map((f) => `\`${f}\``).join(', ')}`,
      );
    }
    if (s.artifacts.missing.length > 0) {
      lines.push(`- Missing artifact kinds: ${s.artifacts.missing.join(', ')}`);
    }
    lines.push(
      `- Citations: ${r.citationLabels.length} emitted (required ≥ ${r.case.minCitationCount})`,
    );
    if (s.sources && s.sources.missing.length > 0) {
      lines.push(
        `- ⚠ missing source fragments: ${s.sources.missing.map((f) => `\`${f}\``).join(', ')}`,
      );
    }
    lines.push('');
    lines.push('<details><summary>Answer text</summary>');
    lines.push('');
    lines.push('```');
    lines.push(r.answerText.length > 0 ? r.answerText : '(empty)');
    lines.push('```');
    lines.push('');
    lines.push('</details>');
  }
  return lines.join('\n');
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();

  const link = new RPCLink({ url: `${args.apiUrl}/rpc` });
  const client = createORPCClient(link) as ContractRouterClient<Contract>;

  let wikiId = args.wikiId as WikiId | undefined;
  if (!wikiId) {
    const list = await client.wiki.listWikis({ limit: 50 });
    if (list.items.length === 0) {
      console.error(
        '[evals] No wikis found at',
        args.apiUrl,
        '— compile a Drive folder first or pass --wikiId=<uuid>.',
      );
      process.exit(2);
    }
    // listWikis returns newest-first; pick that one.
    wikiId = list.items[0]!.id;
    console.error(
      `[evals] Auto-selected newest wiki: ${wikiId} (folder ${list.items[0]?.folderId})`,
    );
  }

  const cases = args.caseId
    ? ANTHROPIC_PAPERS_CASES.filter((c) => c.id === args.caseId)
    : ANTHROPIC_PAPERS_CASES;
  if (cases.length === 0) {
    console.error('[evals] No matching cases for --case=', args.caseId);
    process.exit(2);
  }

  const results: CaseResult[] = [];
  for (const c of cases) {
    console.error(`[evals] running ${c.id} …`);
    const r = await runOneCase(client, wikiId, c, args.perCaseTimeoutMs);
    console.error(
      `[evals]   → ${verdictBadge(r.scores.overall)} (${(r.durationMs / 1000).toFixed(1)}s)`,
    );
    results.push(r);
  }

  const report = renderReport(results, { wikiId, apiUrl: args.apiUrl, startedAt });
  process.stdout.write(`${report}\n`);

  if (args.write) {
    const stamp = startedAt.replace(/[:.]/g, '-');
    const path = `evals/results-${stamp}.md`;
    await Bun.write(path, report);
    console.error(`[evals] wrote ${path}`);
  }

  // Exit code: 0 if all pass, 1 if any non-pass — matches CI conventions.
  const anyNonPass = results.some((r) => r.scores.overall !== 'pass');
  process.exit(anyNonPass ? 1 : 0);
};

main().catch((err) => {
  console.error('[evals] fatal:', err);
  process.exit(2);
});
