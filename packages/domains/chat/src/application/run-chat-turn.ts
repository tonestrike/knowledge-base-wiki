import type { AnswerEvent } from '@package/contracts/chat';
import type { ConversationId, TurnId, WikiId } from '@package/contracts/shared';
import { Turn } from '../domain/turn.ts';
import type { ChatRuntimeDeps } from './ports.ts';
import { researchQuestion } from './research-question.ts';
import { buildHistory, synthesizeAnswer } from './synthesize-answer.ts';

const errorId = (): string => {
  const r =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return r.slice(0, 8);
};

export interface RunChatTurnDeps extends ChatRuntimeDeps {
  /** Optional human-readable label for the wired Researcher implementation,
   *  surfaced in `ResearchStarted.model`. */
  researcherName?: string;
  /** Optional override surfaced in `SynthesisStarted.model`. */
  synthesizerName?: string;
}

export interface RunChatTurnArgs {
  conversationId: ConversationId;
  turnId: TurnId;
  wikiId: WikiId;
  question: string;
}

/**
 * # runChatTurn — the chat-turn execution loop
 *
 * One function, called once per Turn. Drives the entire answer
 * lifecycle and emits a strictly-ordered AnswerEvent stream that
 * downstream subscribers can rely on:
 *
 *     AnswerStarted
 *     ResearchStarted
 *     (WikiPageRetrieved | ResearchProgress)*
 *     ResearchCompleted
 *     SynthesisStarted
 *     (AnswerThinking | AnswerProseDelta | AnswerSegment)*
 *     AnswerFinished | AnswerFailed
 *
 * The terminal event (AnswerFinished / AnswerFailed) is emitted
 * EXACTLY ONCE; the DO uses that signal to mark the tape done and
 * close subscribers.
 *
 * ## Why this function exists separately from the dispatcher
 *
 * Two transports call this same runner:
 *
 *   - **In-memory dispatcher** — dev + tests. Tape lives in a per-
 *     isolate Map. Fast but doesn't survive isolate hops.
 *   - **ChatTurnDO** — prod. Tape lives in a Durable Object's storage,
 *     so chat.ask + chat.streamAnswer (two separate Worker requests
 *     that can land on different isolates) share state.
 *
 * Extracting the loop into a pure function (taking deps + args +
 * emit) lets both transports share the exact same logic. The DO just
 * wraps it with a sequenced + durable emit.
 *
 * ## Why fetch wikiMeta here, not in the synth
 *
 * The synth's interface is `stream({ findings, history?, wikiContext? })`
 * — it shouldn't know about wikiId lookups. The runner is the layer
 * that already has both wikiId and wikiReader, so it gets the meta
 * and threads it as a typed value into the synth's input. Clean
 * separation; the synth stays a thin adapter.
 *
 * ## Consistency model
 *
 * On AnswerFinished, we publish `AnswerProduced` cross-context BEFORE
 * the final `Turn.finish` persist. Failure to publish surfaces as
 * AnswerFailed and persist never runs — preventing the wiki side from
 * never hearing about a successful chat. Persist failure also
 * surfaces as AnswerFailed. The wiki-side consumer must be idempotent
 * on (conversationId, turnId) so a future retry / outbox drain is
 * harmless.
 */
export async function runChatTurn(
  deps: RunChatTurnDeps,
  args: RunChatTurnArgs,
  emit: (e: AnswerEvent) => Promise<void> | void,
): Promise<void> {
  try {
    await emit({ kind: 'AnswerStarted', turnId: args.turnId });
    await emit({
      kind: 'ResearchStarted',
      turnId: args.turnId,
      model: deps.researcherName ?? 'wiki-search',
    });

    console.info('[chat.run-turn] research start', {
      turnId: args.turnId,
      wikiId: args.wikiId,
    });

    // Track which pages we've already announced so the agentic researcher
    // surfacing the same page twice (initial search + later drill-down)
    // doesn't double-emit WikiPageRetrieved.
    const emittedPages = new Set<string>();
    const visitedDuringRun: Array<{ id: string; title: string; pageType?: string; cites: number }> =
      [];
    const { findings, pages, suggestionPages } = await researchQuestion(deps, {
      wikiId: args.wikiId,
      question: args.question,
      onPartial: async ({ findings: count }) => {
        await emit({
          kind: 'ResearchProgress',
          turnId: args.turnId,
          findingsExtracted: count,
        });
      },
      onPageVisited: async (p) => {
        if (emittedPages.has(p.id)) return;
        emittedPages.add(p.id);
        visitedDuringRun.push({
          id: p.id,
          title: p.title,
          ...(p.pageType ? { pageType: p.pageType } : {}),
          cites: p.citations.length,
        });
        await emit({
          kind: 'WikiPageRetrieved',
          turnId: args.turnId,
          wikiPageId: p.id,
          title: p.title,
          pageType: p.pageType,
          citationCount: p.citations.length,
        });
      },
    });

    console.info('[chat.run-turn] research done', {
      turnId: args.turnId,
      pageCount: pages.length,
      findingCount: findings.length,
      suggestionCount: suggestionPages?.length ?? 0,
    });

    // Fallback emit for any page the Researcher returned without firing
    // `onPageVisited` (legacy adapters). Idempotent with the live path.
    for (const p of pages) {
      if (emittedPages.has(p.id)) continue;
      emittedPages.add(p.id);
      await emit({
        kind: 'WikiPageRetrieved',
        turnId: args.turnId,
        wikiPageId: p.id,
        title: p.title,
        pageType: p.pageType,
        citationCount: p.citations.length,
      });
    }

    await emit({
      kind: 'ResearchCompleted',
      turnId: args.turnId,
      candidatePageCount: pages.length,
      findingCount: findings.length,
    });

    // SF-CHAT-2: missing turn is a programmer error, not recoverable. The
    // outer catch reshapes it into AnswerFailed.
    const turn = await deps.turns.findById(args.turnId);
    if (!turn) {
      throw new Error(
        `Turn not found in dispatcher run: ${args.turnId} (conversationId=${args.conversationId})`,
      );
    }

    const prior = await deps.turns.list({
      conversationId: args.conversationId,
      limit: 100,
    });
    const history = buildHistory(prior.items.filter((t) => t.id !== args.turnId));

    // Fetch the wiki's perspective + section names and pass them to the
    // synth. Without this, the synth can hallucinate "this wiki doesn't
    // cover X" when the user's question uses different vocabulary than
    // the page bodies (which often inherit the source documents'
    // language). The taxonomy + perspective tells the synth the framing
    // is deliberate so it uses the findings as-written.
    let wikiContext:
      | { perspective?: string; pageTypes?: ReadonlyArray<string>; folderName?: string }
      | undefined;
    try {
      const meta = await deps.wikiReader.getWikiMeta(args.wikiId);
      if (meta) {
        wikiContext = {
          ...(meta.perspective ? { perspective: meta.perspective } : {}),
          ...(meta.pageTypes.length > 0 ? { pageTypes: meta.pageTypes.map((pt) => pt.name) } : {}),
          ...(meta.folderName ? { folderName: meta.folderName } : {}),
        };
      }
    } catch (metaErr) {
      console.warn(
        '[chat.run-turn] getWikiMeta failed; synth runs without taxonomy hint',
        metaErr instanceof Error ? metaErr.message : metaErr,
      );
    }

    await emit({
      kind: 'SynthesisStarted',
      turnId: args.turnId,
      model: deps.synthesizerName ?? 'anthropic/claude-sonnet-4.6',
    });

    let working: Turn = turn;
    for await (const evt of synthesizeAnswer(
      { synthesizer: deps.synthesizer, sourceHashes: deps.sourceHashes },
      {
        turnId: args.turnId,
        question: args.question,
        findings,
        ...(suggestionPages !== undefined ? { suggestionPages } : {}),
        ...(history.length > 0 ? { history } : {}),
        ...(wikiContext ? { wikiContext } : {}),
      },
    )) {
      // Skip the use-case's own AnswerStarted — already emitted at top.
      if (evt.kind === 'AnswerStarted') continue;
      await emit(evt);
      if (evt.kind === 'AnswerSegment') {
        working = Turn.appendSegment(working, evt.segment);
        await deps.turns.update(working);
      }
      if (evt.kind === 'AnswerFinished') {
        // Publish-then-persist (see consistency-model comment above).
        await deps.eventBus.publish({
          name: 'AnswerProduced',
          occurredAt: deps.now().toISOString(),
          payload: {
            conversationId: args.conversationId,
            turnId: args.turnId,
            wikiId: args.wikiId,
          },
        });
        working = Turn.finish(working, deps.now().toISOString());
        await deps.turns.update(working);
      }
    }
  } catch (err) {
    const id = errorId();
    console.error('[chat.run-turn] run failed', {
      errorId: id,
      conversationId: args.conversationId,
      turnId: args.turnId,
      wikiId: args.wikiId,
      err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    });
    await emit({
      kind: 'AnswerFailed',
      turnId: args.turnId,
      message: `Dispatcher run failed (errorId=${id}, turnId=${args.turnId}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
}
