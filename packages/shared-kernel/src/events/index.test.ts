import { describe, expect, it } from 'bun:test';
import { InMemoryEventBus } from './index.ts';

describe('InMemoryEventBus', () => {
  it('delivers a published event to a subscriber for the matching name', async () => {
    const bus = new InMemoryEventBus();
    const seen: unknown[] = [];
    bus.subscribe('SourceIngested', (e) => {
      seen.push(e);
    });
    await bus.publish({
      name: 'SourceIngested',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: { hello: 'world' } as never,
    });
    expect(seen).toHaveLength(1);
  });

  it('does not deliver to subscribers of a different event name', async () => {
    const bus = new InMemoryEventBus();
    const seen: unknown[] = [];
    bus.subscribe('AnswerProduced', (e) => {
      seen.push(e);
    });
    await bus.publish({
      name: 'SourceIngested',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: {} as never,
    });
    expect(seen).toHaveLength(0);
  });

  it('continues delivery if one subscriber throws', async () => {
    const bus = new InMemoryEventBus();
    let secondCalled = false;
    bus.subscribe('SourceIngested', () => {
      throw new Error('boom');
    });
    bus.subscribe('SourceIngested', () => {
      secondCalled = true;
    });
    await bus.publish({
      name: 'SourceIngested',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: {} as never,
    });
    expect(secondCalled).toBe(true);
  });

  it('returns an unsubscribe function that detaches the handler', async () => {
    const bus = new InMemoryEventBus();
    const seen: unknown[] = [];
    const off = bus.subscribe('SourceIngested', (e) => {
      seen.push(e);
    });
    off();
    await bus.publish({
      name: 'SourceIngested',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: {} as never,
    });
    expect(seen).toHaveLength(0);
  });
});
