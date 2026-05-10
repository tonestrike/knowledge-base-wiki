import type { Turn } from '@package/contracts/chat';
import type { TenexUIMessage } from './chat-message-types.ts';

/**
 * Hydrate persisted Turns (from `chat.listTurns`) into AI SDK
 * `UIMessage`s so `useChat({ messages })` shows history on dock open.
 *
 * Each Turn produces two UIMessages: a `user` carrying the question and
 * an `assistant` carrying the answer segments translated to the same
 * `text` / `data-citation` / `data-artifact` parts the live transport
 * emits. Reasoning parts are skipped — the agent thoughts are ephemeral
 * and aren't persisted on the Turn aggregate.
 *
 * IDs are deterministic so React-Query reloads don't churn the
 * `messages` array identity.
 */
export const turnsToUIMessages = (turns: ReadonlyArray<Turn>): TenexUIMessage[] => {
  const out: TenexUIMessage[] = [];
  for (const turn of turns) {
    out.push({
      id: `${turn.id}:user`,
      role: 'user',
      parts: [{ type: 'text', text: turn.question }],
    });

    const parts: TenexUIMessage['parts'] = [];
    for (const [i, seg] of turn.answer.entries()) {
      if (seg.kind === 'prose') {
        parts.push({ type: 'text', text: seg.text, state: 'done' });
      } else if (seg.kind === 'citation') {
        parts.push({
          type: 'data-citation',
          id: `${turn.id}:cit:${i}`,
          data: seg.citation,
        });
      } else {
        parts.push({
          type: 'data-artifact',
          id: `${turn.id}:art:${i}`,
          data: seg.artifact,
        });
      }
    }
    out.push({ id: `${turn.id}:assistant`, role: 'assistant', parts });
  }
  return out;
};
