import { mockTurn } from '@package/contracts/chat';
import { AnswerSegmentView } from '../components/answer/answer-segment.tsx';

export function ChatRoute() {
  const turn = mockTurn();
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h2 className="font-serif text-2xl">{turn.question}</h2>
      <div className="mt-6 space-y-4">
        {turn.answer.map((seg, i) => (
          <AnswerSegmentView key={`seg-${i}-${seg.kind}`} segment={seg} />
        ))}
      </div>
    </main>
  );
}
