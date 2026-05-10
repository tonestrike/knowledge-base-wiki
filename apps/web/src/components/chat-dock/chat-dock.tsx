import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { orpc } from '../../lib/orpc.ts';
import { AgentLog, deriveLog } from '../answer/agent-log.tsx';
import { AnswerSegmentView } from '../answer/answer-segment.tsx';
import { useAnswerStream } from '../answer/use-answer-stream.ts';
import { Button } from '../ui/button.tsx';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '../ui/sheet.tsx';
import { useChatDock } from './chat-dock-context.tsx';

/**
 * Persistent right-side chat dock. Mounted once at the AppShell level so the
 * user can summon it from any wiki page, page detail, or lint view via Cmd+K
 * (or the "Chat" tab). Conversation state lives in component memory only —
 * each open/ask cycle creates a fresh conversation; previous conversations
 * are listable via `chat.listConversations`.
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
          <ChatPanel wikiId={wikiId} />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
            Open a wiki to start chatting.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ChatPanel({ wikiId }: { wikiId: string }) {
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<string>('');
  const [askedAt, setAskedAt] = useState<number>(Date.now());
  const [, setTickMs] = useState(0);

  // Reuse the most recent conversation for this wiki so the chat history
  // survives dock open/close. Conversations + turns are persisted in D1
  // (PR #27); on dock mount we list and pick the most-recent one.
  const conversations = useQuery({
    ...orpc.chat.listConversations.queryOptions({ input: { wikiId, limit: 20 } }),
    enabled: !!wikiId,
  });

  const open = useMutation({
    ...orpc.chat.open.mutationOptions(),
    onSuccess: (data) => setConversationId(data.conversationId),
  });

  // Pick existing conversation OR create a new one once the list resolves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on wiki / list change
  useEffect(() => {
    if (conversationId) return;
    if (!conversations.data) return;
    const existing = conversations.data.items[0]; // newest first
    if (existing) {
      setConversationId(existing.id);
    } else if (!open.isPending) {
      open.mutate({ wikiId });
    }
  }, [wikiId, conversations.data]);

  // Replay prior turns from D1 so the dock shows history on reopen.
  const turns = useQuery({
    ...orpc.chat.listTurns.queryOptions({
      input: { conversationId: conversationId ?? '', limit: 50 },
    }),
    enabled: !!conversationId,
  });

  const ask = useMutation({
    ...orpc.chat.ask.mutationOptions(),
    onSuccess: (data) => {
      setActiveTurnId(data.turnId);
      if (conversationId) {
        qc.invalidateQueries({
          queryKey: orpc.chat.listTurns.key({ input: { conversationId } }),
        });
      }
    },
  });

  const { segments, events, finished, error } = useAnswerStream(activeTurnId);

  useEffect(() => {
    if (finished || error) return;
    if (!activeTurnId && !ask.isPending) return;
    const t = setInterval(() => setTickMs(Date.now()), 250);
    return () => clearInterval(t);
  }, [activeTurnId, ask.isPending, finished, error]);

  const log = activeTurnId ? deriveLog(events, activeQuestion, askedAt) : null;
  const elapsed = ((Date.now() - askedAt) / 1000).toFixed(1);

  const historyItems = (turns.data?.items ?? []).filter(
    (t) => t.id !== activeTurnId, // don't duplicate the active turn while it streams
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {historyItems.length === 0 && !activeTurnId ? <EmptyPrompt /> : null}

        {historyItems.length > 0 ? (
          <div className="space-y-6 pb-2">
            {historyItems.map((t) => (
              <HistoricalTurn key={t.id} turn={t} />
            ))}
          </div>
        ) : null}

        {activeTurnId ? (
          <div className="space-y-4 border-t border-border/50 pt-4">
            <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                You asked
              </p>
              <p className="mt-1 font-serif text-base leading-snug">{activeQuestion}</p>
            </div>

            <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  Agent thoughts
                </p>
                <p className="font-mono text-[10px] text-accent">{elapsed}s</p>
              </div>
              {log ? <AgentLog entries={log.entries} startedAt={askedAt} /> : null}
            </div>

            <div className="rounded-lg border border-border bg-card/40 px-4 py-4">
              {segments.length === 0 && !error ? (
                <Shimmer />
              ) : (
                <AnimatePresence initial={false}>
                  {segments.map((s, i) => (
                    <motion.div
                      key={`live-seg-${i}-${s.kind}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, delay: i * 0.03 }}
                      className="mb-3 last:mb-0"
                    >
                      <AnswerSegmentView segment={s} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
              {error ? <p className="text-sm text-destructive">Stream failed: {error}</p> : null}
            </div>
          </div>
        ) : null}
      </div>

      <form
        className="flex items-stretch gap-2 border-t border-border px-6 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!conversationId) return;
          const q = draft.trim();
          if (!q) return;
          setActiveQuestion(q);
          setActiveTurnId(null);
          setAskedAt(Date.now());
          setTickMs(0);
          setDraft('');
          ask.mutate({ conversationId, question: q });
        }}
      >
        <input
          // biome-ignore lint/a11y/noAutofocus: dock is summoned on user intent (⌘K), focusing the input is the desired UX
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask anything…"
          className="flex-1 rounded-md border border-input bg-background px-3 py-2.5 text-sm transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
        <Button
          type="submit"
          variant="accent"
          disabled={!conversationId || ask.isPending || !draft.trim()}
        >
          Ask
        </Button>
      </form>
    </div>
  );
}

function HistoricalTurn({
  turn,
}: {
  turn: { id: string; question: string; answer: ReadonlyArray<unknown>; createdAt: string };
}) {
  // `answer` comes off the wire as `AnswerSegment[]`; the type is loose here
  // to keep this component reusable across listTurns/getTurn responses.
  const segments = turn.answer as ReadonlyArray<Parameters<typeof AnswerSegmentView>[0]['segment']>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-3"
    >
      <div className="rounded-lg border border-border/40 bg-card/30 px-4 py-2.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          You asked
        </p>
        <p className="mt-0.5 font-serif text-sm leading-snug">{turn.question}</p>
      </div>
      {segments.length > 0 ? (
        <div className="rounded-lg border border-border/40 bg-card/20 px-4 py-3 space-y-3">
          {segments.map((seg, i) => (
            <AnswerSegmentView key={`hist-${turn.id}-${i}`} segment={seg} />
          ))}
        </div>
      ) : null}
    </motion.div>
  );
}

function EmptyPrompt() {
  return (
    <div className="space-y-4 py-6">
      <p className="font-serif text-lg leading-snug text-muted-foreground">
        Ask any question about this wiki. Every claim in the answer cites the source it came from —
        click any chip to see the verbatim quote.
      </p>
      <ul className="space-y-2 font-mono text-[11px] text-muted-foreground/80">
        <li>· "Summarize the main allegations in this case"</li>
        <li>· "What markets does this involve?"</li>
        <li>· "Quote the legal basis section"</li>
      </ul>
    </div>
  );
}

function Shimmer() {
  return (
    <div className="space-y-2 py-1" aria-live="polite" aria-label="Synthesizing answer">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0.3 }}
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{
            duration: 1.4,
            delay: i * 0.15,
            repeat: Number.POSITIVE_INFINITY,
            ease: 'easeInOut',
          }}
          className="h-3 rounded bg-muted-foreground/20"
          style={{ width: `${100 - i * 12}%` }}
        />
      ))}
    </div>
  );
}
