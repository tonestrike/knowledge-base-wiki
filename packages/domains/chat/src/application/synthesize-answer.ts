import type { AnswerEvent } from '@package/contracts/chat';
import {
  type AnswerSegment,
  Artifact,
  type Citation,
  type TurnId,
} from '@package/contracts/shared';
import {
  CitationTripwireError,
  type PriorTurn,
  type SourceHashVerifier,
  type Synthesizer,
  type SynthesizerInput,
  type WikiPageSummary,
} from './ports.ts';

export interface SynthesizeAnswerDeps {
  synthesizer: Synthesizer;
  sourceHashes: SourceHashVerifier;
}

export interface SynthesizeAnswerInput extends SynthesizerInput {
  turnId: TurnId;
  /**
   * Populated by the researcher when no findings matched the question.
   * The use-case still routes through the LLM (the synthesizer is the
   * agent loop) but seeds it with these pages as findings so the agent
   * has real grounded context to compose a guided "couldn't match that,
   * here's what this wiki covers" response — never a hand-written string.
   */
  suggestionPages?: ReadonlyArray<WikiPageSummary>;
}

/**
 * Cap on how many prior turns of the Conversation flow into the synth
 * prompt. Keeps the prompt bounded; pre-existing turns farther back than
 * this rarely affect followup interpretation and add token cost.
 */
const MAX_HISTORY_TURNS = 6;
/** Per-prior-answer cap so a long previous answer can't dominate the prompt. */
const MAX_HISTORY_ANSWER_CHARS = 1200;

/**
 * Flatten a prior turn's `AnswerSegment[]` into plain text the Synthesizer
 * can thread into its message history. Citation markers and artifact bodies
 * are surfaced as compact text so pronoun / topic references in the next
 * question resolve. Bounded to {@link MAX_HISTORY_ANSWER_CHARS} per turn.
 */
const flattenAnswer = (
  segments: ReadonlyArray<import('@package/contracts/shared').AnswerSegment>,
): string => {
  const parts: string[] = [];
  for (const s of segments) {
    if (s.kind === 'prose') parts.push(s.text);
    else if (s.kind === 'citation') parts.push(`[${s.citation.label}]`);
    else {
      const a = s.artifact;
      switch (a.kind) {
        case 'Quote':
          parts.push(`"${(a.props as { text: string }).text}"`);
          break;
        case 'KeyMetric': {
          const p = a.props as { label: string; value: string };
          parts.push(`${p.label}: ${p.value}`);
          break;
        }
        case 'Markdown':
          parts.push((a.props as { body: string }).body);
          break;
        default:
          parts.push(`[${a.kind} artifact]`);
      }
    }
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text.length > MAX_HISTORY_ANSWER_CHARS
    ? `${text.slice(0, MAX_HISTORY_ANSWER_CHARS)}…`
    : text;
};

/** Convert recent prior Turns of the same Conversation into the bounded
 *  `PriorTurn[]` the Synthesizer thread expects. */
export const buildHistory = (
  priorTurns: ReadonlyArray<{
    question: string;
    answer: ReadonlyArray<import('@package/contracts/shared').AnswerSegment>;
    finishedAt?: string;
  }>,
): PriorTurn[] => {
  return priorTurns
    .filter((t) => t.finishedAt && t.answer.length > 0)
    .slice(-MAX_HISTORY_TURNS)
    .map((t) => ({ question: t.question, answerText: flattenAnswer(t.answer) }))
    .filter((t) => t.answerText.length > 0);
};

const errorId = (): string => {
  // SF-CHAT-1: a short correlation id we attach to AnswerFailed messages
  // and structured logs so a Sentry breadcrumb can be matched against the
  // user-visible error. Not security-sensitive; collisions are fine.
  const r =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return r.slice(0, 8);
};

/**
 * Drives the Synthesizer for one Turn. Yields a fully-typed `AnswerEvent`
 * stream:
 *
 *   AnswerStarted → (AnswerProseDelta | AnswerSegment)* → AnswerFinished
 *
 * Citation-bearing segments are hash-verified BEFORE emission. A failed hash
 * check, an unknown citation id, or a malformed Artifact all abort the stream
 * with `AnswerFailed` — the fabrication tripwire spec §5.1.1 calls for.
 *
 * SF-CHAT-1: tripwire violations (`CitationTripwireError`) are kept as-is in
 * the `AnswerFailed.message` so the UI can show a domain-specific banner;
 * infrastructure errors (network / model / repo) are logged with structured
 * context including an `errorId` and `turnId` and reshaped into a generic
 * AnswerFailed carrying the same correlation id.
 *
 * The function never emits a citation that the model invented: every Citation
 * id must already appear in `input.findings`.
 */
export async function* synthesizeAnswer(
  deps: SynthesizeAnswerDeps,
  input: SynthesizeAnswerInput,
): AsyncGenerator<AnswerEvent, void, void> {
  yield { kind: 'AnswerStarted', turnId: input.turnId };

  // The synthesizer is the agent loop. When the question matched no
  // findings, fall back to the researcher's wiki sample so the agent
  // still has real grounded context to compose a guided "couldn't
  // match that, here's what this wiki covers" response. The model
  // decides what to write — we never hand-author the user-visible
  // string, we just hand it the right findings.
  const synthesizerFindings: SynthesizerInput['findings'] =
    input.findings.length === 0 && (input.suggestionPages?.length ?? 0) > 0
      ? (input.suggestionPages ?? []).map((p) => ({
          quoteText: p.body,
          citationIds: p.citations.map((c) => c.id),
          citations: p.citations,
        }))
      : input.findings;

  const knownCitations = new Map<string, Citation>();
  for (const f of synthesizerFindings) {
    for (const c of f.citations) knownCitations.set(c.id, c);
  }

  const verifiedCache = new Map<string, true>();
  const verify = async (c: Citation): Promise<void> => {
    if (verifiedCache.has(c.id)) return;
    const v = await deps.sourceHashes.verify(c);
    if (!v.ok) {
      throw new CitationTripwireError(
        `Citation ${c.id} failed hash check: ${v.reason} [turnId=${input.turnId}]`,
      );
    }
    verifiedCache.set(c.id, true);
  };

  // When the wiki is genuinely empty (no matched findings AND no sample
  // pages), the synthesizer would otherwise see zero context and could
  // refuse / return []. Augment the user's question with a system note
  // so the model agentically composes a "this wiki has no compiled
  // pages yet — connect and compile a Drive folder first" message.
  // Stays grounded (no citations needed for prose) and never hand-rolls
  // user-facing copy.
  const augmentedQuestion =
    synthesizerFindings.length === 0
      ? `${input.question}\n\n[System note: this wiki has no compiled pages, so the findings list is empty. Reply with a single short prose segment explaining that the wiki is empty and the user needs to connect and compile a Drive folder before chatting. Do not invent citations.]`
      : input.question;

  let segmentsEmitted = 0;
  try {
    for await (const evt of deps.synthesizer.stream({
      question: augmentedQuestion,
      findings: synthesizerFindings,
      ...(input.history !== undefined ? { history: input.history } : {}),
    })) {
      if (evt.kind === 'proseDelta') {
        yield {
          kind: 'AnswerProseDelta',
          turnId: input.turnId,
          segmentIndex: evt.segmentIndex,
          textDelta: evt.textDelta,
        };
        continue;
      }

      const raw = evt.segment;
      let answerSeg: AnswerSegment;
      if (raw.kind === 'prose') {
        if (!raw.text || raw.text.length === 0) {
          throw new CitationTripwireError(
            `Synthesizer emitted an empty prose segment [turnId=${input.turnId}]`,
          );
        }
        answerSeg = { kind: 'prose', text: raw.text };
      } else if (raw.kind === 'citation') {
        const cit = knownCitations.get(raw.citationId);
        if (!cit) {
          throw new CitationTripwireError(
            `Synthesizer cited unknown citation ${raw.citationId} [turnId=${input.turnId}]`,
          );
        }
        await verify(cit);
        answerSeg = { kind: 'citation', citation: cit };
      } else {
        const cites: Citation[] = [];
        for (const id of raw.artifact.citationIds) {
          const cit = knownCitations.get(id);
          if (!cit) {
            throw new CitationTripwireError(
              `Synthesizer cited unknown citation ${id} [turnId=${input.turnId}]`,
            );
          }
          cites.push(cit);
        }
        for (const cit of cites) await verify(cit);
        // Re-validate against the closed Artifact registry. This catches any
        // shape error the upstream structured-output schema might have let
        // through (e.g. extra props, wrong nested types).
        const parsed = Artifact.safeParse({
          kind: raw.artifact.kind,
          props: raw.artifact.props,
          citations: cites,
        });
        if (!parsed.success) {
          throw new CitationTripwireError(
            `Synthesizer emitted an invalid ${raw.artifact.kind} artifact: ${parsed.error.message} [turnId=${input.turnId}]`,
          );
        }
        answerSeg = { kind: 'artifact', artifact: parsed.data };
      }

      yield {
        kind: 'AnswerSegment',
        turnId: input.turnId,
        index: evt.index,
        segment: answerSeg,
      };
      segmentsEmitted += 1;
    }

    yield { kind: 'AnswerFinished', turnId: input.turnId };
  } catch (err) {
    if (err instanceof CitationTripwireError) {
      // Tripwire violations are domain-level, not infra. Surface verbatim.
      yield {
        kind: 'AnswerFailed',
        turnId: input.turnId,
        message: err.message,
      };
      return;
    }
    // Infra / unexpected error: log with structured context for Sentry,
    // then reshape into a user-facing AnswerFailed carrying a correlation
    // id so the operator can match the log line to the user report.
    const id = errorId();
    console.error('[chat.synthesizeAnswer] infra error', {
      errorId: id,
      turnId: input.turnId,
      segmentsEmitted,
      err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    });
    yield {
      kind: 'AnswerFailed',
      turnId: input.turnId,
      message: `Synthesizer failed (errorId=${id}, turnId=${input.turnId}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
