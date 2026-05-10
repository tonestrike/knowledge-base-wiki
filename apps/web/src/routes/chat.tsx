import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ActivityTimeline, type Phase } from '../components/answer/activity-timeline.tsx';
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
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const [tickMs, setTickMs] = useState(0);

  const ask = useMutation({
    ...orpc.chat.ask.mutationOptions(),
    onSuccess: (data) => {
      setActiveTurnId(data.turnId);
      qc.invalidateQueries({ queryKey: orpc.chat.listTurns.key({ input: { conversationId } }) });
    },
  });

  const { segments, finished, error } = useAnswerStream(activeTurnId);

  // Tick a soft elapsed-time counter while the answer is in flight so the
  // active phase pill shows live progress (Vercel AI Elements convention).
  useEffect(() => {
    if (!askedAt || finished || error) return;
    const t = setInterval(() => setTickMs(Date.now() - askedAt), 100);
    return () => clearInterval(t);
  }, [askedAt, finished, error]);

  const phase: Phase = error
    ? 'failed'
    : finished
      ? 'finished'
      : segments.length > 0
        ? 'synthesizing'
        : ask.isPending || (activeTurnId && segments.length === 0)
          ? 'researching'
          : 'asking';

  const elapsed = !askedAt ? 0 : finished || error ? tickMs : Date.now() - askedAt;

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
      <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
        <motion.header
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          <h1 className="font-serif text-4xl tracking-tight">
            {conv.data?.title ?? 'Ask the wiki'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every claim in the answer cites the source it came from. Click any chip to see the
            verbatim quote.
          </p>
        </motion.header>

        {ask.isError ? (
          <ErrorState message={(ask.error as Error).message} onRetry={() => ask.reset()} />
        ) : null}

        <AnimatePresence>
          {activeTurnId ? (
            <motion.div
              key={activeTurnId}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 26 }}
              className="space-y-4"
            >
              {activeQuestion ? (
                <Card className="border-accent/30">
                  <CardContent className="py-4">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      You asked
                    </p>
                    <p className="mt-1 font-serif text-lg leading-snug">{activeQuestion}</p>
                  </CardContent>
                </Card>
              ) : null}

              <ActivityTimeline
                phase={phase}
                durationMs={elapsed}
                segmentCount={segments.length}
                errorMessage={error}
                modelName="anthropic/claude-sonnet-4.6"
              />

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
            </motion.div>
          ) : null}
        </AnimatePresence>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const q = draft.trim();
            if (!q) return;
            setActiveQuestion(q);
            setActiveTurnId(null); // tear down previous turn's stream
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
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <Button type="submit" variant="accent" disabled={ask.isPending || !draft.trim()}>
            Ask
          </Button>
        </form>
      </main>
    </AppShell>
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
          className="h-3 w-full rounded bg-muted-foreground/20"
          style={{ width: `${100 - i * 12}%` }}
        />
      ))}
    </div>
  );
}
