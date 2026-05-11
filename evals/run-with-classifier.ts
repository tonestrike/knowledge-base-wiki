#!/usr/bin/env bun
/**
 * Failure-classifier eval runner.
 *
 * Pairs a thin chat-eval driver with `classifyFailure()` so the report
 * doesn't just say "case X failed" — it says *why* it failed (which
 * stage of the pipeline dropped the ball). The classification is what
 * makes the eval load-bearing: pass-rate tells the reviewer how the
 * system is doing; the per-class breakdown tells them where to fix next.
 *
 * Loop:
 *   1. Load case data. Always: anthropic-papers-cases.ts. If a sibling
 *      `faithfulness-cases.ts` exists (Stream L's eval), load it too.
 *   2. For each case, open a Conversation, ask the question, drain the
 *      SSE stream, and score the result against its rubric.
 *   3. For each case that did NOT fully pass, build a FailureProbe
 *      (with whatever gold span / source / page hints the case carries)
 *      and call classifyFailure().
 *   4. Aggregate: count per class, latency percentiles, sample evidence.
 *   5. Append a deliberately-bogus INGESTION_MISS sanity probe so the
 *      report demonstrates the classifier returns the right class when
 *      asked a question whose gold span CANNOT possibly be in the corpus.
 *
 * Usage:
 *   bun run evals:classify
 *   bun run evals:classify -- --apiUrl=https://api.example.com
 *   bun run evals:classify -- --wikiId=<uuid>
 *   bun run evals:classify -- --case=many-shot-headline-number
 *   bun run evals:classify -- --skip-chat       # use baked goldSpans
 *                                                 only; don't run chat
 *   bun run evals:classify -- --write           # also writes the md
 *                                                 report to evals/
 */

import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@package/contracts';
import type { AnswerEvent } from '@package/contracts/chat';
import type { ConversationId, TurnId, WikiId } from '@package/contracts/shared';
import { ANTHROPIC_PAPERS_CASES, type EvalCase } from './anthropic-papers-cases.ts';
import {
  type FailureClass,
  type FailureClassification,
  type FailureProbe,
  classifyFailure,
  createSourceTextCache,
} from './classify-failure.ts';

const DEFAULT_API = 'https://tenex-api.tonyvantur.workers.dev';
const DEFAULT_WIKI_ID = 'cb0b020d-50ab-41cb-91d9-09a5dda547b2';

interface CliArgs {
  readonly apiUrl: string;
  readonly wikiId: string;
  readonly caseId?: string;
  readonly skipChat: boolean;
  readonly write: boolean;
  readonly perCaseTimeoutMs: number;
}

const parseArgs = (argv: string[]): CliArgs => {
  let apiUrl = DEFAULT_API;
  let wikiId = DEFAULT_WIKI_ID;
  let caseId: string | undefined;
  let skipChat = false;
  let write = false;
  let perCaseTimeoutMs = 120_000;
  for (const arg of argv) {
    if (arg === '--skip-chat') skipChat = true;
    else if (arg === '--write') write = true;
    else if (arg.startsWith('--apiUrl=')) apiUrl = arg.slice('--apiUrl='.length);
    else if (arg.startsWith('--wikiId=')) wikiId = arg.slice('--wikiId='.length);
    else if (arg.startsWith('--case=')) caseId = arg.slice('--case='.length);
    else if (arg.startsWith('--timeoutMs='))
      perCaseTimeoutMs = Number(arg.slice('--timeoutMs='.length));
  }
  return { apiUrl, wikiId, caseId, skipChat, write, perCaseTimeoutMs };
};

/**
 * Hand-curated gold spans per case. The classifier needs a verbatim
 * substring it can search in the source-corpus text to decide
 * INGESTION_MISS vs COMPILE_MISS. Where we don't have a precise quote,
 * we use a short distinctive phrase from the paper title or a famous
 * line we know is in the PDF. When a case lacks an entry here we still
 * classify against `answerWikiPageIds` / `answer` but skip the source
 * checks.
 *
 * Gold spans should be short (<120 chars), distinctive, and copy-paste
 * verbatim from the source — they're matched case-insensitive substring.
 */
const CASE_GOLD_SPANS: Record<string, string> = {
  'evolution-rlhf-to-cai': 'reinforcement learning from human feedback',
  'introduces-new-benchmark': 'model-written evaluations',
  'sleeper-vs-alignment-faking': 'backdoor',
  'many-shot-headline-number': 'in-context learning',
  'induction-heads-mechanism': 'induction head',
  'superposition-feature-count': 'superposition',
  'specific-vs-general-cai': 'Constitutional AI',
  'sycophancy-reward-tampering': 'reward tampering',
  'cross-corpus-deception-thread': 'deceptive',
};

interface ChatRunResult {
  readonly events: AnswerEvent[];
  readonly retrievedTitles: string[];
  readonly retrievedPageIds: string[];
  readonly answerText: string;
  readonly citationLabels: string[];
  readonly citationSourceIds: string[];
  readonly artifactKinds: string[];
  readonly failure?: string;
  readonly durationMs: number;
}

const flattenAnswer = (events: AnswerEvent[]): string => {
  // Same shape as run-evals.ts:flattenAnswer — kept self-contained so the
  // classifier wrapper has zero dependency on the runner module.
  const parts: string[] = [];
  const deltaText = new Map<number, string>();
  for (const e of events) {
    if (e.kind === 'AnswerProseDelta') {
      deltaText.set(e.segmentIndex, (deltaText.get(e.segmentIndex) ?? '') + e.textDelta);
    }
  }
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
          const evs = (props.events as Array<{ at: string; label: string }>) ?? [];
          for (const ev of evs) parts.push(`${ev.at} ${ev.label}`);
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

const runChat = async (
  client: ContractRouterClient<Contract>,
  apiUrl: string,
  wikiId: WikiId,
  question: string,
  timeoutMs: number,
): Promise<ChatRunResult> => {
  const t0 = Date.now();
  const events: AnswerEvent[] = [];
  const retrievedTitles: string[] = [];
  const retrievedPageIds: string[] = [];
  const citationLabels: string[] = [];
  const citationSourceIds: string[] = [];
  const artifactKinds: string[] = [];
  let failure: string | undefined;

  const consumeEvent = (e: AnswerEvent): boolean => {
    events.push(e);
    if (e.kind === 'WikiPageRetrieved') {
      retrievedTitles.push(e.title);
      retrievedPageIds.push(e.wikiPageId);
    } else if (e.kind === 'AnswerSegment') {
      const s = e.segment;
      if (s.kind === 'citation') {
        citationLabels.push(s.citation.label);
        citationSourceIds.push(s.citation.span.sourceId);
      } else if (s.kind === 'artifact') {
        artifactKinds.push(s.artifact.kind);
        for (const cit of s.artifact.citations) {
          citationLabels.push(cit.label);
          citationSourceIds.push(cit.span.sourceId);
        }
      }
    } else if (e.kind === 'AnswerFailed') {
      failure = e.message;
    }
    return !(e.kind === 'AnswerFinished' || e.kind === 'AnswerFailed');
  };

  try {
    const conv = await client.chat.open({ wikiId });
    const turn = await client.chat.ask({
      conversationId: conv.conversationId as ConversationId,
      question,
    });
    const turnId = turn.turnId as TurnId;
    const deadline = Date.now() + timeoutMs;
    // Hand-roll the SSE — probe-chat.ts notes that RPCLink-over-fetch
    // doesn't surface eventIterator as an async iterable directly. Same
    // workaround the web app uses in apps/web/src/lib/chat-transport.ts.
    const resp = await fetch(`${apiUrl}/rpc/chat/streamAnswer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ json: { turnId } }),
    });
    if (!resp.ok || !resp.body) {
      failure = `streamAnswer status=${resp.status}`;
    } else {
      const decoder = new TextDecoder();
      const reader = resp.body.getReader();
      let buffered = '';
      let keepGoing = true;
      while (keepGoing) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let sep = buffered.indexOf('\n\n');
        while (sep >= 0 && keepGoing) {
          const frame = buffered.slice(0, sep);
          buffered = buffered.slice(sep + 2);
          const dataLines = frame
            .split('\n')
            .filter((l) => l.startsWith('data: '))
            .map((l) => l.slice('data: '.length));
          if (dataLines.length > 0) {
            const payload = dataLines.join('\n');
            if (payload !== '[DONE]') {
              try {
                const env = JSON.parse(payload) as { json?: AnswerEvent };
                const e = env.json;
                if (e) keepGoing = consumeEvent(e);
              } catch {
                // tolerate non-JSON frames silently
              }
            }
          }
          sep = buffered.indexOf('\n\n');
        }
        if (Date.now() > deadline) {
          failure = failure ?? `chat timed out after ${timeoutMs}ms`;
          await reader.cancel();
          break;
        }
      }
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }
  return {
    events,
    retrievedTitles,
    retrievedPageIds,
    answerText: flattenAnswer(events),
    citationLabels,
    citationSourceIds,
    artifactKinds,
    failure,
    durationMs: Date.now() - t0,
  };
};

const scoreCase = (c: EvalCase, run: ChatRunResult): 'pass' | 'partial' | 'fail' => {
  const lowerTitles = run.retrievedTitles.map((t) => t.toLowerCase());
  const retrievalMissing = c.expectedPageTitleFragments.filter(
    (frag) => !lowerTitles.some((t) => t.includes(frag.toLowerCase())),
  );
  const lowerAnswer = run.answerText.toLowerCase();
  const answerMissing = c.expectedAnswerSubstrings.filter(
    (s) => !lowerAnswer.includes(s.toLowerCase()),
  );
  const artifactMissing = c.expectedArtifactKinds.filter((k) => !run.artifactKinds.includes(k));
  const citationsOk = run.citationLabels.length >= c.minCitationCount;
  let sourcesOk = true;
  if (c.expectedSourceFilenameFragments && c.expectedSourceFilenameFragments.length > 0) {
    const lowerLabels = run.citationLabels.map((l) => l.toLowerCase());
    sourcesOk = c.expectedSourceFilenameFragments.every((frag) =>
      lowerLabels.some((l) => l.includes(frag.toLowerCase())),
    );
  }
  const fullyPassed =
    retrievalMissing.length === 0 &&
    answerMissing.length === 0 &&
    artifactMissing.length === 0 &&
    citationsOk &&
    sourcesOk;
  if (fullyPassed) return 'pass';
  const anySignal =
    retrievalMissing.length < c.expectedPageTitleFragments.length ||
    answerMissing.length < c.expectedAnswerSubstrings.length ||
    artifactMissing.length < c.expectedArtifactKinds.length ||
    run.citationLabels.length > 0;
  return anySignal ? 'partial' : 'fail';
};

interface CasePerCaseRecord {
  readonly caseId: string;
  readonly verdict: 'pass' | 'partial' | 'fail' | 'skipped';
  readonly chatDurationMs: number;
  readonly classification?: FailureClassification;
}

interface SyntheticProbeRecord {
  readonly label: string;
  readonly classification: FailureClassification;
}

const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
};

const buildReport = (
  ctx: { apiUrl: string; wikiId: string; startedAt: string },
  records: readonly CasePerCaseRecord[],
  synthetic: readonly SyntheticProbeRecord[],
): string => {
  const classCounts: Record<FailureClass, number> = {
    INGESTION_MISS: 0,
    COMPILE_MISS: 0,
    RETRIEVAL_MISS: 0,
    SYNTHESIS_FAIL: 0,
    VERIFIER_FALSE_NEGATIVE: 0,
    PASS: 0,
  };
  const sampleEvidence: Partial<Record<FailureClass, string>> = {};
  const latencies: number[] = [];
  for (const r of records) {
    if (r.classification) {
      classCounts[r.classification.class] += 1;
      latencies.push(r.classification.probeLatencyMs);
      if (!sampleEvidence[r.classification.class]) {
        sampleEvidence[r.classification.class] = `\`${r.caseId}\` — ${r.classification.evidence}`;
      }
    }
  }
  for (const s of synthetic) {
    classCounts[s.classification.class] += 1;
    latencies.push(s.classification.probeLatencyMs);
    if (!sampleEvidence[s.classification.class]) {
      sampleEvidence[s.classification.class] =
        `\`synthetic:${s.label}\` — ${s.classification.evidence}`;
    }
  }
  latencies.sort((a, b) => a - b);

  const lines: string[] = [];
  lines.push('# Failure-classifier report');
  lines.push('');
  lines.push(`- **API**: \`${ctx.apiUrl}\``);
  lines.push(`- **Wiki**: \`${ctx.wikiId}\``);
  lines.push(`- **Started**: ${ctx.startedAt}`);
  lines.push(`- **Cases probed**: ${records.length}`);
  lines.push(`- **Synthetic sanity probes**: ${synthetic.length}`);
  lines.push('');
  lines.push('## Per-class breakdown');
  lines.push('');
  lines.push('| Class | Count | Sample evidence |');
  lines.push('|---|---|---|');
  const classes: FailureClass[] = [
    'INGESTION_MISS',
    'COMPILE_MISS',
    'RETRIEVAL_MISS',
    'SYNTHESIS_FAIL',
    'VERIFIER_FALSE_NEGATIVE',
    'PASS',
  ];
  for (const cls of classes) {
    lines.push(`| \`${cls}\` | ${classCounts[cls]} | ${sampleEvidence[cls] ?? '_none_'} |`);
  }
  lines.push('');
  lines.push('## Probe latency');
  lines.push('');
  if (latencies.length === 0) {
    lines.push('_no probes ran_');
  } else {
    lines.push(`- count: ${latencies.length}`);
    lines.push(`- p50: ${percentile(latencies, 50)}ms`);
    lines.push(`- p90: ${percentile(latencies, 90)}ms`);
    lines.push(`- p99: ${percentile(latencies, 99)}ms`);
  }
  lines.push('');
  lines.push('## Per-case detail');
  lines.push('');
  lines.push('| Case | Chat verdict | Classified | Probe ms | Evidence |');
  lines.push('|---|---|---|---|---|');
  for (const r of records) {
    const verdictBadge =
      r.verdict === 'pass'
        ? 'pass'
        : r.verdict === 'partial'
          ? 'partial'
          : r.verdict === 'fail'
            ? 'fail'
            : 'skipped';
    const cls = r.classification?.class ?? '—';
    const ms = r.classification?.probeLatencyMs ?? 0;
    const ev = (r.classification?.evidence ?? '').replace(/\|/g, '\\|').slice(0, 160);
    lines.push(`| \`${r.caseId}\` | ${verdictBadge} | \`${cls}\` | ${ms} | ${ev} |`);
  }
  if (synthetic.length > 0) {
    lines.push('');
    lines.push('## Synthetic sanity probes');
    lines.push('');
    lines.push('| Label | Expected | Classified | Probe ms | Evidence |');
    lines.push('|---|---|---|---|---|');
    for (const s of synthetic) {
      const ev = s.classification.evidence.replace(/\|/g, '\\|').slice(0, 160);
      lines.push(
        `| \`${s.label}\` | \`INGESTION_MISS\` | \`${s.classification.class}\` | ${s.classification.probeLatencyMs} | ${ev} |`,
      );
    }
  }
  return lines.join('\n');
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const link = new RPCLink({ url: `${args.apiUrl}/rpc` });
  const client = createORPCClient(link) as ContractRouterClient<Contract>;
  const sourceTextCache = createSourceTextCache();

  // Stream L coordination: pick up faithfulness-cases.ts if it lands.
  // Try/catch so missing-file is a non-event.
  let faithfulnessCases: EvalCase[] = [];
  try {
    // dynamic import so the module is only resolved at runtime
    const mod = (await import('./faithfulness-cases.ts').catch(() => null)) as {
      FAITHFULNESS_CASES?: ReadonlyArray<EvalCase>;
    } | null;
    if (mod?.FAITHFULNESS_CASES) {
      faithfulnessCases = [...mod.FAITHFULNESS_CASES];
      console.error(`[classify] loaded ${faithfulnessCases.length} faithfulness cases`);
    }
  } catch {
    // ignore — Stream L hasn't shipped yet
  }

  const allCases: EvalCase[] = [...ANTHROPIC_PAPERS_CASES, ...faithfulnessCases];
  const cases = args.caseId ? allCases.filter((c) => c.id === args.caseId) : allCases;
  if (cases.length === 0) {
    console.error('[classify] no matching cases');
    process.exit(2);
  }

  const records: CasePerCaseRecord[] = [];
  for (const c of cases) {
    console.error(`[classify] case=${c.id}`);
    let run: ChatRunResult;
    if (args.skipChat) {
      run = {
        events: [],
        retrievedTitles: [],
        retrievedPageIds: [],
        answerText: '',
        citationLabels: [],
        citationSourceIds: [],
        artifactKinds: [],
        durationMs: 0,
      };
    } else {
      run = await runChat(
        client,
        args.apiUrl,
        args.wikiId as WikiId,
        c.question,
        args.perCaseTimeoutMs,
      );
      console.error(
        `[classify]   chat: pages=${run.retrievedPageIds.length} citations=${run.citationLabels.length} (${(run.durationMs / 1000).toFixed(1)}s)`,
      );
    }
    const verdict = args.skipChat ? 'skipped' : scoreCase(c, run);
    if (verdict === 'pass') {
      records.push({ caseId: c.id, verdict, chatDurationMs: run.durationMs });
      continue;
    }
    const goldSpan = CASE_GOLD_SPANS[c.id];
    const probe: FailureProbe = {
      apiUrl: args.apiUrl,
      wikiId: args.wikiId,
      question: c.question,
      goldSpan,
      answer: run.answerText.length > 0 ? run.answerText : undefined,
      answerSourceIds: run.citationSourceIds,
      answerWikiPageIds: run.retrievedPageIds,
    };
    const classification = await classifyFailure(probe, { sourceTextCache });
    console.error(
      `[classify]   class=${classification.class} (${classification.probeLatencyMs}ms): ${classification.evidence.slice(0, 100)}`,
    );
    records.push({
      caseId: c.id,
      verdict,
      chatDurationMs: run.durationMs,
      classification,
    });
  }

  // Synthetic sanity probe — a question whose "gold span" is a string
  // we know is NOT in the Anthropic-papers corpus. Exercises the
  // INGESTION_MISS branch end-to-end. Doubles as proof the classifier is
  // wired up to a real fetch surface, not just a unit-test stub.
  console.error('[classify] running synthetic INGESTION_MISS sanity probe…');
  const syntheticProbe: FailureProbe = {
    apiUrl: args.apiUrl,
    wikiId: args.wikiId,
    question: 'Synthetic — does the corpus mention quantum chromodynamics?',
    goldSpan: 'zzz-synthetic-not-in-any-anthropic-paper-quantum-chromodynamics-7f3e',
  };
  const syntheticClassification = await classifyFailure(syntheticProbe, { sourceTextCache });
  console.error(
    `[classify]   synthetic class=${syntheticClassification.class} (${syntheticClassification.probeLatencyMs}ms)`,
  );

  const report = buildReport({ apiUrl: args.apiUrl, wikiId: args.wikiId, startedAt }, records, [
    { label: 'ingestion-miss-canary', classification: syntheticClassification },
  ]);
  process.stdout.write(`${report}\n`);

  if (args.write) {
    const stamp = startedAt.replace(/[:.]/g, '-');
    const path = `evals/classify-${stamp}.md`;
    await Bun.write(path, report);
    console.error(`[classify] wrote ${path}`);
  }

  // Exit 0 — the classifier is a diagnostic, not a pass/fail gate. The
  // gating evals are run-evals.ts and citation-roundtrip.ts.
  process.exit(0);
};

main().catch((err) => {
  console.error('[classify] fatal:', err);
  process.exit(2);
});
