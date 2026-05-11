import { Fragment } from 'react';
import type { TenexUIMessage } from '../../lib/chat-message-types.ts';
import { Message, MessageContent, MessageResponse } from '../ai-elements/message.tsx';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '../ai-elements/reasoning.tsx';
import { ArtifactView } from '../answer/artifact-registry.tsx';
import { CitationChip } from '../citation/citation-chip.tsx';

/**
 * True if the assistant message has any user-visible content yet (text,
 * citation, artifact, or non-empty reasoning). Lets the dock skip
 * rendering an empty bubble while waiting for the first chunk.
 */
export const hasRenderableContent = (message: TenexUIMessage): boolean => {
  for (const p of message.parts) {
    if (p.type === 'text' && p.text.length > 0) return true;
    if (p.type === 'reasoning' && p.text.length > 0) return true;
    if (p.type === 'data-citation' || p.type === 'data-artifact') return true;
  }
  return false;
};

/**
 * Renders a single `TenexUIMessage` following the canonical AI Elements
 * shape (Message → MessageContent → MessageResponse). Reasoning parts are
 * consolidated into a single block at the top of the assistant message
 * (per the AI Elements `reasoning.md` reference) so that consecutive
 * "Thinking…" indicators don't stack.
 *
 * Citation and Artifact data parts are tenex-specific and rendered via
 * our existing `CitationChip` and `ArtifactView`. The other data parts
 * (`turn-meta`, `wiki-page-retrieved`) are informational and rendered
 * inside the reasoning bubble or skipped.
 */
export function ChatMessageView({
  message,
  isLastMessage,
  isStreaming,
}: {
  message: TenexUIMessage;
  isLastMessage: boolean;
  isStreaming: boolean;
}) {
  if (message.role === 'user') {
    return (
      <Message from="user">
        <MessageContent>
          {message.parts.map((part, i) =>
            part.type === 'text' ? (
              <MessageResponse key={`u-${message.id}-${i}`}>{part.text}</MessageResponse>
            ) : null,
          )}
        </MessageContent>
      </Message>
    );
  }

  const reasoningParts = message.parts.filter((p) => p.type === 'reasoning');
  const reasoningText = reasoningParts.map((p) => p.text).join('\n\n');
  const lastPart = message.parts.at(-1);
  const isReasoningStreaming = isLastMessage && isStreaming && lastPart?.type === 'reasoning';
  // True when the model finished reasoning but hasn't produced any
  // user-visible answer part yet — i.e. the silent gap between the
  // closed "Thought for Ns" bubble and the first prose / citation /
  // artifact. Used to render a pulsing "Composing answer…" indicator
  // so the user sees the chat is still doing something.
  const hasAnswerPart = message.parts.some(
    (p) => p.type === 'text' || p.type === 'data-citation' || p.type === 'data-artifact',
  );
  const isComposingGap = isLastMessage && isStreaming && reasoningText.length > 0 && !hasAnswerPart;

  return (
    <Message from="assistant">
      <MessageContent>
        {reasoningText.length > 0 ? (
          <Reasoning className="w-full" isStreaming={isReasoningStreaming}>
            <ReasoningTrigger />
            <ReasoningContent>{reasoningText}</ReasoningContent>
          </Reasoning>
        ) : null}
        {isComposingGap ? <ComposingPulse /> : null}
        {message.parts.map((part, i) => {
          const key = `a-${message.id}-${i}`;
          if (part.type === 'text') {
            return <MessageResponse key={key}>{part.text}</MessageResponse>;
          }
          if (part.type === 'data-citation') {
            return (
              <Fragment key={key}>
                <CitationChip citation={part.data} />
              </Fragment>
            );
          }
          if (part.type === 'data-artifact') {
            return (
              <div key={key} className="my-2">
                <ArtifactView artifact={part.data} />
              </div>
            );
          }
          return null;
        })}
      </MessageContent>
    </Message>
  );
}

/**
 * Renders during the gap between the closed reasoning bubble and the
 * first answer chunk — the (often 5-30s) window while the synth model
 * is composing tool calls / artifacts but hasn't emitted any
 * user-visible parts yet. Three pulsing dots + a phrase, accent-tinted,
 * matches the rest of the dock typography.
 */
function ComposingPulse() {
  return (
    <div className="my-2 flex items-center gap-2 text-muted-foreground">
      <span className="flex gap-1" aria-hidden>
        <span className="size-1.5 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-accent/60" />
        <span
          className="size-1.5 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-accent/60"
          style={{ animationDelay: '160ms' }}
        />
        <span
          className="size-1.5 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-accent/60"
          style={{ animationDelay: '320ms' }}
        />
      </span>
      <span className="font-mono text-xs uppercase tracking-[0.2em] text-accent/70">
        Composing answer
      </span>
    </div>
  );
}
