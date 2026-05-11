/**
 * One-shot chat probe — asks a single hard-coded question against the
 * running api, prints every SSE event verbatim. For diagnosing where
 * the agentic loop is going janky end-to-end.
 *
 * Usage:
 *   bun run evals/probe-chat.ts "your question here"
 */
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { Contract } from '@package/contracts';
import type { AnswerEvent } from '@package/contracts/chat';
import type { ConversationId, WikiId } from '@package/contracts/shared';

const API = 'https://api.tenex.localhost:1355';
const QUESTION = process.argv[2] ?? 'What is constitutional AI?';

const link = new RPCLink({ url: `${API}/rpc` });
const client = createORPCClient(link) as ContractRouterClient<Contract>;

const wikis = await client.wiki.listWikis({ limit: 1 });
const wiki = wikis.items[0];
if (!wiki) {
  console.error('No wikis');
  process.exit(1);
}
console.log(`[probe] wiki=${wiki.id} pages=${wiki.pageCount}`);
console.log(`[probe] Q: ${QUESTION}`);

const conv = await client.chat.open({ wikiId: wiki.id as WikiId });
const turn = await client.chat.ask({
  conversationId: conv.conversationId as ConversationId,
  question: QUESTION,
});
console.log(`[probe] turn=${turn.turnId}`);

// Hand-roll the SSE because oRPC's RPCLink-over-fetch doesn't surface
// the eventIterator as an async iterable directly; the web app does the
// same hand-roll in apps/web/src/lib/chat-transport.ts.
const resp = await fetch(`${API}/rpc/chat/streamAnswer`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
  body: JSON.stringify({ json: { turnId: turn.turnId } }),
});
if (!resp.ok || !resp.body) {
  console.error(`[probe] streamAnswer status=${resp.status}`);
  console.error(await resp.text());
  process.exit(1);
}

const start = Date.now();
let firstToken: number | null = null;
let segs = 0;
let proseChunks = 0;

const decoder = new TextDecoder();
const reader = resp.body.getReader();
let buffered = '';

const consumeFrame = (frame: string): boolean => {
  // SSE frames are `data: <json>\n` blocks. We grab everything after `data: `
  // and treat the rest of the frame body as JSON.
  const dataLines = frame
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice('data: '.length));
  if (dataLines.length === 0) return true;
  const payload = dataLines.join('\n');
  if (payload === '[DONE]') return false;
  let env: { json?: AnswerEvent } | undefined;
  try {
    env = JSON.parse(payload);
  } catch {
    return true;
  }
  const e = env?.json;
  if (!e) return true;
  const t = ((Date.now() - start) / 1000).toFixed(2);
  if (e.kind === 'AnswerProseDelta') {
    if (firstToken === null) firstToken = Date.now() - start;
    proseChunks += 1;
    process.stdout.write(`[${t}s] prose+="${e.textDelta.replace(/\n/g, '↵')}"\n`);
  } else if (e.kind === 'AnswerSegment') {
    segs += 1;
    const s = e.segment;
    if (s.kind === 'prose') {
      console.log(
        `[${t}s] SEGMENT prose[${e.index}]: "${s.text.slice(0, 80).replace(/\n/g, '↵')}…"`,
      );
    } else if (s.kind === 'citation') {
      console.log(
        `[${t}s] SEGMENT citation[${e.index}]: ${s.citation.id.slice(0, 8)}… "${s.citation.label}"`,
      );
    } else {
      console.log(`[${t}s] SEGMENT artifact[${e.index}]: ${s.artifact.kind}`);
    }
  } else if (e.kind === 'WikiPageRetrieved') {
    console.log(
      `[${t}s] WikiPageRetrieved: "${e.title}" (${e.pageType ?? '-'}) · ${e.citationCount} cites`,
    );
  } else if (
    e.kind === 'ResearchStarted' ||
    e.kind === 'ResearchCompleted' ||
    e.kind === 'SynthesisStarted' ||
    e.kind === 'AnswerStarted' ||
    e.kind === 'AnswerFinished'
  ) {
    console.log(`[${t}s] ${e.kind}`);
  } else if (e.kind === 'AnswerFailed') {
    console.log(`[${t}s] AnswerFailed: ${e.message}`);
  }
  return e.kind !== 'AnswerFinished' && e.kind !== 'AnswerFailed';
};

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffered += decoder.decode(value, { stream: true });
  let sep = buffered.indexOf('\n\n');
  while (sep >= 0) {
    const frame = buffered.slice(0, sep);
    buffered = buffered.slice(sep + 2);
    if (!consumeFrame(frame)) {
      await reader.cancel();
      break;
    }
    sep = buffered.indexOf('\n\n');
  }
}

console.log(
  `[probe] done. total ${((Date.now() - start) / 1000).toFixed(2)}s, first-token=${firstToken === null ? 'never' : `${firstToken / 1000}s`}, segments=${segs}, proseChunks=${proseChunks}`,
);
