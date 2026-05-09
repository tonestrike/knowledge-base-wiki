import { describe, expect, it } from 'bun:test';
import {
  citationId,
  claimId,
  compileRunId,
  conversationId,
  folderId,
  lintFindingId,
  lintRunId,
  sourceId,
  turnId,
  wikiId,
  wikiPageId,
} from '../shared/ids.ts';
import {
  AnswerProduced,
  CompileFinished,
  CorrectionAccepted,
  DomainEvent,
  SchemaInferred,
  SourceIngested,
} from './index.ts';

describe('domain events', () => {
  it('DomainEvent is a discriminated union of the five event names', () => {
    expect(DomainEvent.options.map((o) => o.shape.name.value)).toEqual([
      'SourceIngested',
      'SchemaInferred',
      'CompileFinished',
      'AnswerProduced',
      'CorrectionAccepted',
    ]);
  });

  it('SourceIngested carries source identity + folder context', () => {
    const e = SourceIngested.parse({
      name: 'SourceIngested',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: {
        sourceId: sourceId('11111111-2222-4333-8444-555555555555'),
        folderId: folderId('22222222-2222-4333-8444-555555555555'),
        contentHash: 'sha256:abc',
        filename: 'q3.pdf',
      },
    });
    expect(e.payload.filename).toBe('q3.pdf');
  });

  it('CompileFinished references both the wiki and the run', () => {
    const e = CompileFinished.parse({
      name: 'CompileFinished',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: {
        compileRunId: compileRunId('33333333-2222-4333-8444-555555555555'),
        wikiId: wikiId('44444444-2222-4333-8444-555555555555'),
        pageCount: 12,
      },
    });
    expect(e.payload.pageCount).toBe(12);
  });

  it('SchemaInferred carries the inferred WikiSchema verbatim', () => {
    const e = SchemaInferred.parse({
      name: 'SchemaInferred',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: {
        compileRunId: compileRunId('33333333-2222-4333-8444-555555555555'),
        wikiId: wikiId('44444444-2222-4333-8444-555555555555'),
        schema: {
          pageTypes: [{ name: 'Decision', description: 'd' }],
          relations: [],
        },
      },
    });
    expect(e.payload.schema.pageTypes).toHaveLength(1);
  });

  it('AnswerProduced points to the conversation+turn', () => {
    AnswerProduced.parse({
      name: 'AnswerProduced',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: {
        conversationId: conversationId('55555555-2222-4333-8444-555555555555'),
        turnId: turnId('66666666-2222-4333-8444-555555555555'),
        wikiId: wikiId('44444444-2222-4333-8444-555555555555'),
      },
    });
  });

  it('CorrectionAccepted references the lint finding being applied', () => {
    CorrectionAccepted.parse({
      name: 'CorrectionAccepted',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: {
        lintRunId: lintRunId('77777777-2222-4333-8444-555555555555'),
        lintFindingId: lintFindingId('88888888-2222-4333-8444-555555555555'),
        wikiPageId: wikiPageId('dddddddd-1111-4222-8333-444444444444'),
        claimId: claimId('cccccccc-1111-4222-8333-444444444444'),
        replacementText: 'Q3 NRR was 105%.',
        newCitationId: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
      },
    });
  });
});
