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
 * The one true chat-turn execution loop.
 *
 * Both transports — the in-process `createInMemoryDispatcher` (dev / tests)
 * and the Cloudflare `ChatTurnDO` (prod) — call this with their own
 * `emit` adapter. The runner produces an ordered AnswerEvent stream:
 *
 *   AnswerStarted → ResearchStarted → WikiPageRetrieved* →
 *   ResearchCompleted → SynthesisStarted → (AnswerThinking|AnswerProseDelta|
 *   AnswerSegment)* → AnswerFinished | AnswerFailed
 *
 * The terminal event (AnswerFinished / AnswerFailed) is always emitted
 * exactly once; consumers can use it to close subscribers and mark the
 * tape as done.
 *
 * Consistency model (SF-CHAT-3): on AnswerFinished we publish
 * `AnswerProduced` BEFORE the final `Turn.finish` persist. Publish
 * failure surfaces as AnswerFailed and persist never runs; persist
 * failure also surfaces as AnswerFailed. The wiki-side `AnswerProduced`
 * consumer must be idempotent on (conversationId, turnId).
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
