import { useChat } from '@ai-sdk/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CopyIcon, MessageSquareIcon, RefreshCcwIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { TenexUIMessage } from '../../lib/chat-message-types.ts';
import { createTenexChatTransport } from '../../lib/chat-transport.ts';
import { orpc } from '../../lib/orpc.ts';
import { turnsToUIMessages } from '../../lib/turns-to-ui-messages.ts';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '../ai-elements/conversation.tsx';
import { MessageAction, MessageActions } from '../ai-elements/message.tsx';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '../ai-elements/prompt-input.tsx';
import { Spinner } from '../ai-elements/ui/spinner.tsx';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet.tsx';
import { useChatDock } from './chat-dock-context.tsx';
import { ChatMessageView, hasRenderableContent } from './chat-message-view.tsx';

/**
 * Persistent right-side chat dock. Mounted once at the AppShell level so
 * the user can summon it from any wiki page, page detail, or lint view via
 * Cmd+K (or the "Chat" tab). Conversation state is persisted in D1 — the
 * dock picks the most-recent conversation per wiki and replays its turns
 * into `useChat`'s initial messages so history survives dock open/close.
 */
export function ChatDock() {
  const { open, wikiId, close } = useChatDock();
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="font-serif text-2xl tracking-tight">Ask the wiki</SheetTitle>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            ⌘K to toggle · every claim cites its source
          </p>
        </SheetHeader>
        {wikiId ? (
          <ChatPanelLoader wikiId={wikiId} />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            Open a wiki to start chatting.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Picks the most-recent Conversation for this wiki, or opens a new one if
 * none exists yet. Once a conversation is in hand we mount `ChatPanel`
 * keyed by `conversationId` so swapping wikis fully resets `useChat`'s
 * internal state.
 */
function ChatPanelLoader({ wikiId }: { wikiId: string }) {
  const [conversationId, setConversationId] = useState<string | null>(null);

  const conversations = useQuery({
    ...orpc.chat.listConversations.queryOptions({ input: { wikiId, limit: 1 } }),
    enabled: !!wikiId,
  });

  const open = useMutation({
    ...orpc.chat.open.mutationOptions(),
    onSuccess: (data) => setConversationId(data.conversationId),
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: only on wiki / list change
  useEffect(() => {
    if (conversationId) return;
    if (!conversations.data) return;
    const existing = conversations.data.items[0];
    if (existing) {
      setConversationId(existing.id);
    } else if (!open.isPending) {
      open.mutate({ wikiId });
    }
  }, [wikiId, conversations.data]);

  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
        Opening conversation…
      </div>
    );
  }
  return <ChatPanel key={conversationId} conversationId={conversationId} />;
}

/**
 * Loads prior turns from D1, hydrates them into AI SDK UIMessages, and
 * mounts the live chat panel. Splitting hydration from `useChat` lets us
 * pass a stable `messages` array exactly once instead of re-seeding on
 * every refetch.
 */
function ChatPanel({ conversationId }: { conversationId: string }) {
  const turns = useQuery({
    ...orpc.chat.listTurns.queryOptions({ input: { conversationId, limit: 50 } }),
  });

  if (turns.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
        Loading history…
      </div>
    );
  }

  return <ChatPanelLive conversationId={conversationId} initialTurns={turns.data?.items ?? []} />;
}

function ChatPanelLive({
  conversationId,
  initialTurns,
}: {
  conversationId: string;
  initialTurns: Parameters<typeof turnsToUIMessages>[0];
}) {
  const initialMessages = useMemo(() => turnsToUIMessages(initialTurns), [initialTurns]);
  const transport = useMemo(() => createTenexChatTransport({ conversationId }), [conversationId]);
  const { messages, sendMessage, stop, regenerate, status, error } = useChat<TenexUIMessage>({
    messages: initialMessages,
    transport,
  });

  const isStreaming = status === 'streaming';
  const handleSubmit = (msg: PromptInputMessage) => {
    const text = msg.text.trim();
    if (!text) return;
    void sendMessage({ text });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Conversation>
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<MessageSquareIcon className="size-10" />}
              title="Ask any question about this wiki."
              description="Every claim cites the source it came from — click any chip to see the verbatim quote."
            />
          ) : (
            messages.map((message, index) => {
              const isLast = index === messages.length - 1;
              // While the assistant turn hasn't streamed any content yet,
              // skip the empty bubble entirely. We render a Spinner
              // outside the map below to show progress instead.
              if (
                message.role === 'assistant' &&
                !hasRenderableContent(message) &&
                !(isLast && isStreaming)
              ) {
                return null;
              }
              const lastTextPart = [...message.parts].reverse().find((p) => p.type === 'text');
              return (
                <div key={message.id} className="space-y-1">
                  <ChatMessageView
                    message={message}
                    isLastMessage={isLast}
                    isStreaming={isStreaming}
                  />
                  {message.role === 'assistant' &&
                  isLast &&
                  status === 'ready' &&
                  hasRenderableContent(message) ? (
                    <MessageActions>
                      <MessageAction tooltip="Regenerate" onClick={() => regenerate()}>
                        <RefreshCcwIcon className="size-3" />
                      </MessageAction>
                      {lastTextPart?.type === 'text' ? (
                        <MessageAction
                          tooltip="Copy"
                          onClick={() => {
                            void navigator.clipboard.writeText(lastTextPart.text);
                          }}
                        >
                          <CopyIcon className="size-3" />
                        </MessageAction>
                      ) : null}
                    </MessageActions>
                  ) : null}
                </div>
              );
            })
          )}
          {status === 'submitted' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Working on it…
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive">Stream failed: {error.message}</p>
          ) : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput onSubmit={handleSubmit} className="border-t border-border">
        <PromptInputBody>
          <PromptInputTextarea placeholder="Ask anything…" />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit status={status} onStop={() => void stop()} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
