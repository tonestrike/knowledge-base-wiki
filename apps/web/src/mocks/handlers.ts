import { mockAnswerEventStream, mockConversation, mockTurn } from '@package/contracts/chat';
import { mockIngestEventStream, mockListSources } from '@package/contracts/ingestion';
import {
  mockLintEventStream,
  mockLintFinding,
  mockLintRun,
  mockUnsupportedFinding,
} from '@package/contracts/verification';
import {
  demoSchema,
  mockCompileEventStream,
  mockWiki,
  mockWikiPage,
} from '@package/contracts/wiki';
import { http, HttpResponse } from 'msw';

const wiki = mockWiki();
const page = mockWikiPage();
const conversation = mockConversation();
const turn = mockTurn();
const lintRun = mockLintRun();
const supported = mockLintFinding();
const unsupported = mockUnsupportedFinding();

const sse = (factory: () => AsyncIterable<unknown>): Response => {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const e of factory()) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
          await new Promise((r) => setTimeout(r, 600));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
};

export const handlers = [
  // wiki reads
  http.get('/rpc/wikis/:id', () => HttpResponse.json(wiki)),
  http.get('/rpc/wikis/:id/schema', () => HttpResponse.json(demoSchema)),
  http.get('/rpc/wikis', () => HttpResponse.json({ items: [wiki] })),
  http.get('/rpc/wiki-pages/:id', () => HttpResponse.json(page)),
  http.get('/rpc/wiki-pages', () => HttpResponse.json({ items: [page] })),

  // ingestion
  http.get('/rpc/sources', () => HttpResponse.json(mockListSources())),
  http.post('/rpc/drive/folders', () =>
    HttpResponse.json({ folderId: '22222222-2222-4333-8444-555555555555' }),
  ),
  http.post('/rpc/folders/:folderId/ingest', ({ params }) =>
    HttpResponse.json({ folderId: params.folderId, sourceCount: 2 }),
  ),
  http.get('/rpc/folders/:folderId/ingest/events', () => sse(mockIngestEventStream)),

  // wiki compile
  http.post('/rpc/compile-runs', () =>
    HttpResponse.json({ compileRunId: '33333333-2222-4333-8444-555555555555' }),
  ),
  http.get('/rpc/compile-runs/:id', ({ params }) =>
    HttpResponse.json({
      id: params.id,
      folderId: '22222222-2222-4333-8444-555555555555',
      wikiId: wiki.id,
      status: 'finished',
      startedAt: '2026-05-09T12:00:00.000Z',
      endedAt: '2026-05-09T12:01:00.000Z',
    }),
  ),
  http.get('/rpc/compile-runs/:compileRunId/events', () => sse(mockCompileEventStream)),

  // chat
  http.post('/rpc/conversations', () => HttpResponse.json({ conversationId: conversation.id })),
  http.get('/rpc/conversations/:id', () => HttpResponse.json(conversation)),
  http.get('/rpc/conversations', () => HttpResponse.json({ items: [conversation] })),
  http.post('/rpc/turns', () => HttpResponse.json({ turnId: turn.id })),
  http.get('/rpc/turns/:id', () => HttpResponse.json(turn)),
  http.get('/rpc/turns', () => HttpResponse.json({ items: [turn] })),
  http.get('/rpc/turns/:turnId/answer/events', () => sse(mockAnswerEventStream)),

  // verification
  http.post('/rpc/lint-runs', () => HttpResponse.json({ lintRunId: lintRun.id })),
  http.get('/rpc/lint-runs/:id', () => HttpResponse.json(lintRun)),
  http.get('/rpc/lint-runs', () => HttpResponse.json({ items: [lintRun] })),
  http.get('/rpc/lint-findings', () => HttpResponse.json({ items: [supported, unsupported] })),
  http.get('/rpc/lint-findings/:id', () => HttpResponse.json(supported)),
  http.post('/rpc/lint-findings/:id/apply', () =>
    HttpResponse.json({ appliedAt: new Date().toISOString() }),
  ),
  http.get('/rpc/lint-runs/:lintRunId/events', () => sse(mockLintEventStream)),
];
