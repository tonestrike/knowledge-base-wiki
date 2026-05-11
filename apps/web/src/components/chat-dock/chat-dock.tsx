import { useChat } from '@ai-sdk/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CopyIcon, MessageSquareIcon, RefreshCcwIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { PromptInputMessage } from '../ai-elements/prompt-input.tsx';
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
/**
 * Drag-to-resize for the chat dock. The user drags the left edge of the
 * panel; we compute width from cursor position relative to the viewport's
 * right edge. Clamped to [380, 1200] so the panel never gets uselessly
 * narrow or completely takes over the page. Persisted in localStorage so
 * the chosen width survives dock open/close and full page reload.
 *
 * Why pixels in inline style instead of a tailwind utility: the value is
 * truly continuous (the user can land at any pixel), and Sheet's stock
 * `sm:max-w-*` cap fights against a custom width. We override sheet's
 * width entirely.
 */
const DOCK_WIDTH_STORAGE_KEY = 'tenex.chatDock.width.px';
const DOCK_WIDTH_DEFAULT = 640;
const DOCK_WIDTH_MIN = 380;
const DOCK_WIDTH_MAX = 1200;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const useDockWidth = (): {
  width: number;
  startDrag: (e: React.PointerEvent<HTMLElement>) => void;
  isDragging: boolean;
} => {
  const [width, setWidth] = useState<number>(DOCK_WIDTH_DEFAULT);
  const [isDragging, setIsDragging] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only seed
  useEffect(() => {
    const stored = window.localStorage.getItem(DOCK_WIDTH_STORAGE_KEY);
    if (stored) {
      const n = Number.parseInt(stored, 10);
      if (Number.isFinite(n)) setWidth(clamp(n, DOCK_WIDTH_MIN, DOCK_WIDTH_MAX));
    }
  }, []);

  const startDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    setIsDragging(true);
    const onMove = (ev: PointerEvent) => {
      // Right-anchored panel: width = viewport-width minus cursor x.
      const next = clamp(window.innerWidth - ev.clientX, DOCK_WIDTH_MIN, DOCK_WIDTH_MAX);
      setWidth(next);
    };
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // Persist on release rather than every frame.
      setWidth((w) => {
        window.localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(w));
        return w;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  return { width, startDrag, isDragging };
};

export function ChatDock() {
  const { open, wikiId, close } = useChatDock();
  const { width, startDrag, isDragging } = useDockWidth();
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent
        side="right"
        // Override Sheet's stock width cap with a continuous pixel
        // value driven by the drag handle. `!max-w-none` cancels the
        // `sm:max-w-sm` from sheet.tsx without forking the primitive.
        className="flex w-full flex-col gap-0 !max-w-none p-0"
        style={{ width: `${width}px` }}
      >
        {/* Drag handle on the left edge. 6px hit target widens on hover so
            the user can grab it without precision; cursor is `ew-resize`.
            While dragging, an inset overlay disables text selection
            globally so the cursor doesn't lose the handle on fast moves. */}
        {/* biome-ignore lint/a11y/useSemanticElements: <hr> can't host pointer interaction; this is the drag handle and not real semantics. */}
        <button
          type="button"
          onPointerDown={startDrag}
          aria-label="Resize chat dock — drag horizontally"
          className="group absolute inset-y-0 left-0 z-40 flex w-1.5 cursor-ew-resize items-center justify-center hover:bg-accent/20"
        >
          <div className="h-12 w-0.5 rounded-full bg-border/0 transition-colors group-hover:bg-accent/60" />
        </button>
        {isDragging ? (
          <div className="fixed inset-0 z-[60] cursor-ew-resize" style={{ userSelect: 'none' }} />
        ) : null}

        <SheetHeader className="border-b border-border px-6 py-4 pr-14">
          <SheetTitle className="font-serif text-2xl tracking-tight">Ask the wiki</SheetTitle>
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
            ⌘K to toggle · every claim cites its source · drag the left edge to resize
          </p>
        </SheetHeader>
        {wikiId ? <ChatPanelLoader wikiId={wikiId} /> : <ChatDockEmptyState />}
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
/**
 * Shown when the dock opens with no `wikiId` in scope (Cmd+K from the
 * home page, or any route that doesn't carry a wiki context). Resolves
 * the user's most-recent wiki in the background; if one exists we auto-
 * bind to it so the user can chat immediately. If there are none, we
 * surface a clear CTA pointing at the home picker so they can compile
 * a folder first.
 */
function ChatDockEmptyState() {
  const { openFor, close } = useChatDock();
  const list = useQuery({
    ...orpc.wiki.listWikis.queryOptions({ input: { limit: 1 } }),
  });
  const newest = list.data?.items[0];

  // Auto-bind once if a wiki is found. The dock immediately re-renders
  // with `wikiId` set, mounting the actual chat panel.
  // biome-ignore lint/correctness/useExhaustiveDependencies: openFor + close are stable from context
  useEffect(() => {
    if (newest?.id) openFor(newest.id);
  }, [newest?.id]);

  if (list.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
        Loading conversation context…
      </div>
    );
  }
  if (newest) {
    // Brief flicker while the effect fires; render a soft pulse so it
    // doesn't look broken.
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
        Opening your latest wiki…
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-serif text-2xl tracking-tight">No wikis yet</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Compile a Drive folder first — once a wiki exists, chat will ground every answer in its
        pages.
      </p>
      <button
        type="button"
        onClick={() => {
          close();
          window.location.assign('/');
        }}
        className="mt-2 rounded-full border border-accent bg-accent px-5 py-2 font-mono text-xs uppercase tracking-[0.25em] text-accent-foreground shadow-[0_0_24px_-8px_var(--accent)] transition-transform hover:-translate-y-0.5"
      >
        Connect a folder
      </button>
    </div>
  );
}

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

      {/* Hand-rolled composer: a single rounded card with a textarea +
          submit button on one row, matching the shape of Claude.ai /
          ChatGPT composers. We avoid PromptInputBody / PromptInputFooter
          here because they're built on an InputGroup CSS grid that
          forces tools and submit onto a separate row and leaves an
          ugly empty cell when we try to inline them. The PromptInput
          form wrapper still owns submission flow + Enter-to-send
          (PromptInputTextarea handles the keyboard) — we just override
          the visual layout. */}
      <Composer onSubmit={handleSubmit} status={status} stop={stop} />
    </div>
  );
}

/**
 * Inline composer. One rounded card; textarea grows from 1 to ~6 lines;
 * a small send button floats at the bottom-right corner. Enter submits;
 * Shift+Enter inserts a newline. Empty input disables the button.
 *
 * We do submission via a manual `requestSubmit` on the host form (the
 * outer PromptInput) when the user hits Enter or clicks the button,
 * which keeps `handleSubmit`'s plumbing into useChat untouched.
 */
function Composer({
  onSubmit,
  status,
  stop,
}: {
  onSubmit: (msg: PromptInputMessage) => void;
  status: ReturnType<typeof useChat>['status'];
  stop: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const isStreaming = status === 'submitted' || status === 'streaming';
  const canSend = text.trim().length > 0 && !isStreaming;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Autosize: clamp between 1 and 6 lines.
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 6 * 24 + 16)}px`;
  }, []);
  useEffect(() => {
    resize();
  }, [resize]);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit({ text: trimmed } as PromptInputMessage);
    setText('');
    // Reset autosize after a tick once the controlled value clears.
    requestAnimationFrame(resize);
  };

  return (
    <div className="border-t border-border bg-background px-4 py-3">
      <div className="flex items-end gap-2 rounded-xl border border-input bg-card/40 px-3 py-1.5 shadow-xs transition-colors focus-within:border-accent/60 focus-within:bg-card/60">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            resize();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSend) handleSend();
            }
          }}
          placeholder="Ask anything…"
          rows={1}
          className="my-1.5 max-h-40 flex-1 resize-none self-center bg-transparent text-sm leading-5 placeholder:text-muted-foreground/60 focus:outline-none"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={() => void stop()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground"
            aria-label="Stop generation"
          >
            <Spinner />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Send message"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <title>Send</title>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
