import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnswerSegmentView } from '../components/answer/answer-segment.tsx';
import { useAnswerStream } from '../components/answer/use-answer-stream.ts';
import { AppShell } from '../components/app-shell.tsx';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { isBackendNotImplemented, useLiveMode } from '../lib/live-mode.tsx';
import { orpc } from '../lib/orpc.ts';

// Loose UUID v4 check — keeps the contract validation in one place but
// catches the empty / typo'd query-param case here so the route never
// gets stuck in an infinite LoadingState (SF9).
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

  // Validate the URL parameter before kicking off the mutation, otherwise
  // an empty / malformed wikiId silently strands the user on a spinner.
  if (!wikiIdValid) {
    return (
      <AppShell>
        <main className="mx-auto max-w-3xl space-y-4 px-6 py-10">
          <ErrorState message="No wiki specified for this chat." />
          <p className="text-sm text-muted-foreground">
            <Link to="/" className="underline-offset-4 hover:text-accent hover:underline">
              ← Back to folder picker
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

  const ask = useMutation({
    ...orpc.chat.ask.mutationOptions(),
    onSuccess: (data) => {
      setActiveTurnId(data.turnId);
      setDraft('');
      qc.invalidateQueries({ queryKey: orpc.chat.listTurns.key({ input: { conversationId } }) });
    },
  });

  // SF2 — destructure `error` and surface it in the UI; previously the
  // chat route threw the field away and the user saw a phantom "streaming…"
  // forever when the SSE produced an `AnswerFailed` event.
  const { segments, finished, error } = useAnswerStream(activeTurnId);

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
        <header>
          <h1 className="font-serif text-3xl tracking-tight">{conv.data?.title ?? 'Chat'}</h1>
        </header>

        {ask.isError ? (
          <ErrorState message={(ask.error as Error).message} onRetry={() => ask.reset()} />
        ) : null}

        {activeTurnId ? (
          <Card>
            <CardContent className="space-y-4 py-6">
              {segments.length === 0 && !error ? (
                <p className="text-sm text-muted-foreground">streaming…</p>
              ) : (
                segments.map((s, i) => (
                  <AnswerSegmentView key={`live-seg-${i}-${s.kind}`} segment={s} />
                ))
              )}
              {error ? (
                <ErrorState
                  message={`Answer stream failed: ${error}`}
                  onRetry={() => {
                    // Force the hook to tear down and resubscribe by
                    // toggling the turn id — the parent mutation flow will
                    // rehydrate via React Query if the user retries Ask.
                    setActiveTurnId(null);
                  }}
                />
              ) : null}
              {!finished && !error ? (
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  streaming…
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            ask.mutate({ conversationId, question: draft });
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask the wiki…"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <Button type="submit" variant="accent" disabled={ask.isPending || !draft.trim()}>
            Ask
          </Button>
        </form>
      </main>
    </AppShell>
  );
}
