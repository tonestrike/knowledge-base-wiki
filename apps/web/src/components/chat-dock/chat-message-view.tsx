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

  return (
    <Message from="assistant">
      <MessageContent>
        {reasoningText.length > 0 ? (
          <Reasoning className="w-full" isStreaming={isReasoningStreaming}>
            <ReasoningTrigger />
            <ReasoningContent>{reasoningText}</ReasoningContent>
          </Reasoning>
        ) : null}
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
