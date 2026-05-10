import { describe, expect, it } from 'bun:test';
import {
  type LintRunId,
  type WikiId,
  compileRunId,
  lintRunId,
  wikiId,
} from '@package/contracts/shared';
import { InMemoryEventBus } from '@package/shared-kernel';
import { subscribeCompileFinished } from './compile-subscription.ts';

describe('subscribeCompileFinished', () => {
  it('starts a LintRun for the wiki when CompileFinished fires', async () => {
    const bus = new InMemoryEventBus();
    const started: Array<{ lintRunId: LintRunId; wikiId: WikiId }> = [];
    let counter = 0;

    subscribeCompileFinished(
      {
        newId: () => `77777777-2222-4333-8444-${(counter++).toString(16).padStart(12, '0')}`,
        lintDispatcher: {
          start: async (args) => {
            started.push(args);
          },
          subscribe: async function* () {},
        },
      },
      bus,
    );

    const targetWiki = wikiId('44444444-2222-4333-8444-555555555555');
    await bus.publish({
      name: 'CompileFinished',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: {
        compileRunId: compileRunId('99999999-2222-4333-8444-555555555555'),
        wikiId: targetWiki,
        finishedAt: '2026-05-09T12:00:00.000Z',
        pageCount: 12,
      },
    });

    expect(started).toHaveLength(1);
    expect(started[0]?.wikiId).toBe(targetWiki);
    expect(started[0]?.lintRunId).toBe(lintRunId('77777777-2222-4333-8444-000000000000'));
  });

  it('returns an unsubscribe function that detaches the handler', async () => {
    const bus = new InMemoryEventBus();
    const started: WikiId[] = [];

    const unsubscribe = subscribeCompileFinished(
      {
        newId: () => '77777777-2222-4333-8444-000000000000',
        lintDispatcher: {
          start: async ({ wikiId }) => {
            started.push(wikiId);
          },
          subscribe: async function* () {},
        },
      },
      bus,
    );

    unsubscribe();

    await bus.publish({
      name: 'CompileFinished',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: {
        compileRunId: compileRunId('99999999-2222-4333-8444-555555555555'),
        wikiId: wikiId('44444444-2222-4333-8444-555555555555'),
        finishedAt: '2026-05-09T12:00:00.000Z',
        pageCount: 12,
      },
    });

    expect(started).toHaveLength(0);
  });
});
