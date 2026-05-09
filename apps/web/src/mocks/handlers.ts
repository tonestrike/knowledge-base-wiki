import { mockConversation, mockTurn } from '@package/contracts/chat';
import { mockListSources } from '@package/contracts/ingestion';
import {
  mockLintFinding,
  mockLintRun,
  mockUnsupportedFinding,
} from '@package/contracts/verification';
import { demoSchema, mockWiki, mockWikiPage } from '@package/contracts/wiki';
import { http, HttpResponse } from 'msw';

const wiki = mockWiki();
const page = mockWikiPage();
const conversation = mockConversation();
const turn = mockTurn();
const lintRun = mockLintRun();
const supported = mockLintFinding();
const unsupported = mockUnsupportedFinding();

export const handlers = [
  http.get('/rpc/wikis/:id', () => HttpResponse.json(wiki)),
  http.get('/rpc/wikis/:id/schema', () => HttpResponse.json(demoSchema)),
  http.get('/rpc/wikis', () => HttpResponse.json({ items: [wiki] })),
  http.get('/rpc/wiki-pages/:id', () => HttpResponse.json(page)),
  http.get('/rpc/wiki-pages', () => HttpResponse.json({ items: [page] })),

  http.get('/rpc/sources', () => HttpResponse.json(mockListSources())),

  http.get('/rpc/conversations/:id', () => HttpResponse.json(conversation)),
  http.post('/rpc/conversations', () => HttpResponse.json({ conversationId: conversation.id })),
  http.get('/rpc/turns/:id', () => HttpResponse.json(turn)),
  http.post('/rpc/turns', () => HttpResponse.json({ turnId: turn.id })),

  http.get('/rpc/lint-runs/:id', () => HttpResponse.json(lintRun)),
  http.get('/rpc/lint-runs', () => HttpResponse.json({ items: [lintRun] })),
  http.get('/rpc/lint-findings', () => HttpResponse.json({ items: [supported, unsupported] })),
  http.post('/rpc/lint-findings/:id/apply', () =>
    HttpResponse.json({ appliedAt: new Date().toISOString() }),
  ),
];
