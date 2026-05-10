import type { AnswerEvent } from '@package/contracts/chat';
import {
  type AnswerSegment,
  Artifact,
  type Citation,
  type TurnId,
} from '@package/contracts/shared';
import {
  CitationTripwireError,
  type SourceHashVerifier,
  type Synthesizer,
  type SynthesizerInput,
} from './ports.ts';

export interface SynthesizeAnswerDeps {
  synthesizer: Synthesizer;
  sourceHashes: SourceHashVerifier;
}

export interface SynthesizeAnswerInput extends SynthesizerInput {
  turnId: TurnId;
}

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

  const knownCitations = new Map<string, Citation>();
  for (const f of input.findings) {
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

  let segmentsEmitted = 0;
  try {
    for await (const evt of deps.synthesizer.stream({
      question: input.question,
      findings: input.findings,
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
