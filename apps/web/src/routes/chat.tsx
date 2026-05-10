import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AgentLog, deriveLog } from '../components/answer/agent-log.tsx';
import { AnswerSegmentView } from '../components/answer/answer-segment.tsx';
import { useAnswerStream } from '../components/answer/use-answer-stream.ts';
import { AppShell } from '../components/app-shell.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { isBackendNotImplemented, useLiveMode } from '../lib/live-mode.tsx';
import { orpc } from '../lib/orpc.ts';

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
  const qc = useQueryClient();
  const conv = useQuery({
    ...orpc.chat.getConversation.queryOptions({ input: { id: conversationId } }),
    enabled: !!conversationId,
  });

  const [draft, setDraft] = useState('');
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<string>('');
  const [askedAt, setAskedAt] = useState<number>(Date.now());
  const [, setTickMs] = useState(0);

  const ask = useMutation({
    ...orpc.chat.ask.mutationOptions(),
    onSuccess: (data) => {
      setActiveTurnId(data.turnId);
      qc.invalidateQueries({ queryKey: orpc.chat.listTurns.key({ input: { conversationId } }) });
    },
  });

  const { segments, events, finished, error } = useAnswerStream(activeTurnId);

  // Tick a soft elapsed-time counter while the answer is in flight so the
  // log timestamps and progress bar stay live.
  useEffect(() => {
    if (finished || error) return;
    if (!activeTurnId && !ask.isPending) return;
    const t = setInterval(() => setTickMs(Date.now()), 200);
    return () => clearInterval(t);
  }, [activeTurnId, ask.isPending, finished, error]);

  const log = activeTurnId ? deriveLog(events, activeQuestion, askedAt) : null;
  const status = log?.status ?? (ask.isPending ? 'queued' : 'queued');
  const elapsedSec = ((Date.now() - askedAt) / 1000).toFixed(1);

  if (conv.isPending) {
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
      <main className="mx-auto max-w-4xl space-y-8 px-6 py-10">
        <motion.header
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <h1 className="font-serif text-4xl tracking-tight">Ask the wiki</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every claim cites the source it came from. Click any chip to see the verbatim quote.
          </p>
        </motion.header>

        {ask.isError ? (
          <ErrorState message={(ask.error as Error).message} onRetry={() => ask.reset()} />
        ) : null}

        <AnimatePresence mode="wait">
          {activeTurnId ? (
            <motion.div
              key={activeTurnId}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 26 }}
              className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]"
            >
              <div className="space-y-4">
                <Card className="border-accent/30">
                  <CardContent className="py-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                      You asked
                    </p>
                    <p className="mt-1 font-serif text-lg leading-snug">{activeQuestion}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="space-y-4 py-6">
                    {segments.length === 0 && !error ? (
                      <ShimmeringPlaceholder />
                    ) : (
                      <AnimatePresence initial={false}>
                        {segments.map((s, i) => (
                          <motion.div
                            key={`live-seg-${i}-${s.kind}`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2, delay: i * 0.04 }}
                          >
                            <AnswerSegmentView segment={s} />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    )}
                    {error ? (
                      <ErrorState
                        message={`Answer stream failed: ${error}`}
                        onRetry={() => setActiveTurnId(null)}
                      />
                    ) : null}
                  </CardContent>
                </Card>
              </div>

              <aside className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                    Agent thoughts
                  </p>
                  <StatusPill status={status} elapsed={elapsedSec} />
                </div>
                <Card>
                  <CardContent className="py-5">
                    {log ? (
                      <AgentLog entries={log.entries} startedAt={askedAt} />
                    ) : (
                      <p className="text-xs text-muted-foreground">waiting for turn…</p>
                    )}
                  </CardContent>
                </Card>
                <p className="font-mono text-[10px] text-muted-foreground/80">
                  Researcher: anthropic/claude-sonnet-4.6 · Synthesizer: anthropic/claude-sonnet-4.6
                </p>
              </aside>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <form
          className="flex items-stretch gap-2"
          onSubmit={(e) => {
            e.preventDefault();
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask the wiki…"
            className="flex-1 rounded-md border border-input bg-background px-4 py-3 text-base font-serif transition-colors focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/40"
          />
          <Button
            type="submit"
            variant="accent"
            disabled={ask.isPending || !draft.trim()}
            className="px-6"
          >
            Ask
          </Button>
        </form>
      </main>
    </AppShell>
  );
}

function StatusPill({
  status,
  elapsed,
}: {
  status: 'queued' | 'researching' | 'synthesizing' | 'finished' | 'failed';
  elapsed: string;
}) {
  const tone =
    status === 'finished'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : status === 'failed'
        ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
        : 'border-accent/40 bg-accent/10 text-accent';
  const label =
    status === 'researching'
      ? 'researching'
      : status === 'synthesizing'
        ? 'synthesizing'
        : status === 'finished'
          ? 'done'
          : status === 'failed'
            ? 'failed'
            : 'queued';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tone}`}
    >
      {status !== 'finished' && status !== 'failed' ? (
        <span className="relative inline-flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
        </span>
      ) : (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {label} · {elapsed}s
    </span>
  );
}

function ShimmeringPlaceholder() {
  return (
    <div className="space-y-2" aria-live="polite" aria-label="Synthesizing answer">
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
