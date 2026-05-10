import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnswerSegmentView } from '../components/answer/answer-segment.tsx';
import { useAnswerStream } from '../components/answer/use-answer-stream.ts';
import { ErrorState } from '../components/states/error.tsx';
import { LoadingState } from '../components/states/loading.tsx';
import { ThemeToggle } from '../components/theme-toggle.tsx';
import { Button } from '../components/ui/button.tsx';
import { Card, CardContent } from '../components/ui/card.tsx';
import { orpc } from '../lib/orpc.ts';

export function ChatRoute() {
  const { conversationId = '' } = useParams();
  if (conversationId === 'new') return <ChatNewRoute />;
  return <ChatActiveRoute conversationId={conversationId} />;
}

function ChatNewRoute() {
  const [params] = useSearchParams();
  const wikiId = params.get('wikiId') ?? '';
  const nav = useNavigate();
  const open = useMutation({
    ...orpc.chat.open.mutationOptions(),
    onSuccess: (data) => nav(`/chat/${data.conversationId}`, { replace: true }),
  });
  const openMutate = open.mutate;
  useEffect(() => {
    if (!wikiId) return;
    openMutate({ wikiId });
  }, [wikiId, openMutate]);
  if (open.isError) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <ErrorState message={(open.error as Error).message} />
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <LoadingState rows={2} />
    </main>
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

  const { segments, finished } = useAnswerStream(activeTurnId);

  if (conv.isPending) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <LoadingState rows={3} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
      <header className="flex items-baseline justify-between">
        <h1 className="font-serif text-3xl tracking-tight">{conv.data?.title ?? 'Chat'}</h1>
        <ThemeToggle />
      </header>

      {activeTurnId ? (
        <Card>
          <CardContent className="space-y-4 py-6">
            {segments.length === 0 ? (
              <p className="text-sm text-muted-foreground">streaming…</p>
            ) : (
              segments.map((s, i) => (
                <AnswerSegmentView key={`live-seg-${i}-${s.kind}`} segment={s} />
              ))
            )}
            {!finished ? (
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
  );
}
