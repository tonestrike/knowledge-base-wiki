import { useChat } from '@ai-sdk/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CopyIcon, MessageSquareIcon, RefreshCcwIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '../components/ai-elements/conversation.tsx';
import { MessageAction, MessageActions } from '../components/ai-elements/message.tsx';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '../components/ai-elements/prompt-input.tsx';
import { Spinner } from '../components/ai-elements/ui/spinner.tsx';
import { AppShell } from '../components/app-shell.tsx';
import {
  ChatMessageView,
  hasRenderableContent,
} from '../components/chat-dock/chat-message-view.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import type { TenexUIMessage } from '../lib/chat-message-types.ts';
import { createTenexChatTransport } from '../lib/chat-transport.ts';
import { isBackendNotImplemented, useLiveMode } from '../lib/live-mode.tsx';
import { orpc } from '../lib/orpc.ts';
import { turnsToUIMessages } from '../lib/turns-to-ui-messages.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ChatRoute() {
  const { conversationId = '' } = useParams();
  if (conversationId === 'new') return <ChatNewRoute />;
  return <ChatActiveRoute conversationId={conversationId} />;
}

function ChatNewRoute() {
  const [params] = useSearchParams();
  const wikiId = params.get('wikiId') ?? '';
  const wikiIdValid = UUID_RE.test(wikiId);
  const nav = useNavigate();
  const { markUnavailable } = useLiveMode();
  const open = useMutation({
    ...orpc.chat.open.mutationOptions(),
    onSuccess: (data) => nav(`/chat/${data.conversationId}`, { replace: true }),
    onError: (e) => {
      if (isBackendNotImplemented(e)) {
        markUnavailable('chat.open is not implemented in the current backend phase.');
      }
    },
  });
  const openMutate = open.mutate;
  useEffect(() => {
    if (!wikiIdValid) return;
    openMutate({ wikiId });
  }, [wikiId, wikiIdValid, openMutate]);

  if (!wikiIdValid) {
    return (
      <AppShell>
        <main className="mx-auto max-w-3xl space-y-4 px-6 py-10">
          <ErrorState message="No wiki specified for this chat." />
          <p className="text-sm text-muted-foreground">
            <Link to="/" className="underline-offset-4 hover:text-accent hover:underline">
              ← Back to home
            </Link>
          </p>
        </main>
      </AppShell>
    );
  }
  if (open.isError) {
    return (
      <AppShell wikiId={wikiId}>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <ErrorState message={(open.error as Error).message} />
        </main>
      </AppShell>
    );
  }
  return (
    <AppShell wikiId={wikiId}>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <LoadingState rows={2} />
      </main>
    </AppShell>
  );
}

function ChatActiveRoute({ conversationId }: { conversationId: string }) {
  const conv = useQuery({
    ...orpc.chat.getConversation.queryOptions({ input: { id: conversationId } }),
    enabled: !!conversationId,
  });
  const turns = useQuery({
    ...orpc.chat.listTurns.queryOptions({ input: { conversationId, limit: 50 } }),
    enabled: !!conversationId,
  });

  if (conv.isPending || turns.isPending) {
    return (
      <AppShell>
        <main className="mx-auto max-w-3xl px-6 py-10">
          <LoadingState rows={3} />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell wikiId={conv.data?.wikiId} trail={[{ label: conv.data?.title ?? 'New chat' }]}>
      <ChatMain conversationId={conversationId} initialTurns={turns.data?.items ?? []} />
    </AppShell>
  );
}

function ChatMain({
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
    <main className="mx-auto flex h-[calc(100vh-4rem)] max-w-4xl flex-col px-6 py-10">
      <header className="mb-4">
        <h1 className="font-serif text-4xl tracking-tight">Ask the wiki</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every claim cites the source it came from. Click any chip to see the verbatim quote.
        </p>
      </header>

      <Conversation className="flex-1">
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
          {error ? <ErrorState message={`Answer stream failed: ${error.message}`} /> : null}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput onSubmit={handleSubmit} className="mt-4">
        <PromptInputBody>
          <PromptInputTextarea placeholder="Ask the wiki…" />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools />
          <PromptInputSubmit status={status} onStop={() => void stop()} />
        </PromptInputFooter>
      </PromptInput>
    </main>
  );
}
