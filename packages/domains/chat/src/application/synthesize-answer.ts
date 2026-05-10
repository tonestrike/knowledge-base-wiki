import type { AnswerEvent } from '@package/contracts/chat';
import {
  type AnswerSegment,
  Artifact,
  type Citation,
  type TurnId,
} from '@package/contracts/shared';
import type { Synthesizer, SynthesizerInput } from './ports.ts';
import type { SourceHashVerifier } from './ports.ts';

export interface SynthesizeAnswerDeps {
  synthesizer: Synthesizer;
  sourceHashes: SourceHashVerifier;
}

export interface SynthesizeAnswerInput extends SynthesizerInput {
  turnId: TurnId;
}

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
    if (!v.ok) throw new Error(`Citation ${c.id} failed hash check: ${v.reason}`);
    verifiedCache.set(c.id, true);
  };

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
          throw new Error('Synthesizer emitted an empty prose segment');
        }
        answerSeg = { kind: 'prose', text: raw.text };
      } else if (raw.kind === 'citation') {
        const cit = knownCitations.get(raw.citationId);
        if (!cit) throw new Error(`Synthesizer cited unknown citation ${raw.citationId}`);
        await verify(cit);
        answerSeg = { kind: 'citation', citation: cit };
      } else {
        const cites: Citation[] = [];
        for (const id of raw.artifact.citationIds) {
          const cit = knownCitations.get(id);
          if (!cit) throw new Error(`Synthesizer cited unknown citation ${id}`);
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
          throw new Error(
            `Synthesizer emitted an invalid ${raw.artifact.kind} artifact: ${parsed.error.message}`,
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
    }

    yield { kind: 'AnswerFinished', turnId: input.turnId };
  } catch (err) {
    yield {
      kind: 'AnswerFailed',
      turnId: input.turnId,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
