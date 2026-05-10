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

// SF6 — every mocked response carries `x-mock: msw` so devs (and future
// integration tests) can assert "did this hit the mock or the real
// backend" without parsing payloads.
const MOCK_HEADER = { 'x-mock': 'msw' };

// Helper: tag JSON responses with the x-mock header. We accept any
// shape here because each fixture is already typed by the contract;
// MSW types parameterize on its internal `JsonBodyType`, which is
// intentionally narrower than the contract types. Casting at the
// boundary keeps every call site type-safe.
const json = (body: unknown): Response =>
  HttpResponse.json(body as Parameters<typeof HttpResponse.json>[0], { headers: MOCK_HEADER });

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
      ...MOCK_HEADER,
    },
  });
};

export const handlers = [
  // wiki reads
  http.get('/rpc/wikis/:id', () => json(wiki)),
  http.get('/rpc/wikis/:id/schema', () => json(demoSchema)),
  http.get('/rpc/wikis', () => json({ items: [wiki] })),
  http.get('/rpc/wiki-pages/:id', () => json(page)),
  http.get('/rpc/wiki-pages', () => json({ items: [page] })),

  // ingestion
  http.get('/rpc/sources', () => json(mockListSources())),
  http.post('/rpc/drive/folders', () => json({ folderId: '22222222-2222-4333-8444-555555555555' })),
  http.post('/rpc/folders/:folderId/ingest', ({ params }) =>
    json({ folderId: params.folderId, sourceCount: 2 }),
  ),
  http.get('/rpc/folders/:folderId/ingest/events', () => sse(mockIngestEventStream)),

  // wiki compile
  http.post('/rpc/compile-runs', () =>
    json({ compileRunId: '33333333-2222-4333-8444-555555555555' }),
  ),
  http.get('/rpc/compile-runs/:id', ({ params }) =>
    json({
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
  http.post('/rpc/conversations', () => json({ conversationId: conversation.id })),
  http.get('/rpc/conversations/:id', () => json(conversation)),
  http.get('/rpc/conversations', () => json({ items: [conversation] })),
  http.post('/rpc/turns', () => json({ turnId: turn.id })),
  http.get('/rpc/turns/:id', () => json(turn)),
  http.get('/rpc/turns', () => json({ items: [turn] })),
  http.get('/rpc/turns/:turnId/answer/events', () => sse(mockAnswerEventStream)),

  // verification
  http.post('/rpc/lint-runs', () => json({ lintRunId: lintRun.id })),
  http.get('/rpc/lint-runs/:id', () => json(lintRun)),
  http.get('/rpc/lint-runs', () => json({ items: [lintRun] })),
  http.get('/rpc/lint-findings', () => json({ items: [supported, unsupported] })),
  http.get('/rpc/lint-findings/:id', () => json(supported)),
  http.post('/rpc/lint-findings/:id/apply', () => json({ appliedAt: new Date().toISOString() })),
  http.get('/rpc/lint-runs/:lintRunId/events', () => sse(mockLintEventStream)),
];
