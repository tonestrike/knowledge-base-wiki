import { describe, expect, it } from 'bun:test';
import type { DomainEventMap } from './index.ts';
import { InMemoryEventBus } from './index.ts';

const samplePayload = (): DomainEventMap['SourceIngested'] => ({
  sourceId: '11111111-2222-4333-8444-555555555555',
  folderId: '22222222-2222-4333-8444-555555555555',
  contentHash: 'sha256:abc',
  filename: 'q3.pdf',
});

describe('InMemoryEventBus', () => {
  it('delivers a published event to a subscriber for the matching name', async () => {
    const bus = new InMemoryEventBus();
    const seen: DomainEventMap['SourceIngested'][] = [];
    bus.subscribe('SourceIngested', (e) => {
      seen.push(e.payload);
    });
    await bus.publish({
      name: 'SourceIngested',
      occurredAt: '2026-05-09T12:00:00.000Z',
      payload: samplePayload(),
    });
    expect(seen).toHaveLength(1);
  });

  it('rejects misspelled event names at compile time', () => {
    const bus = new InMemoryEventBus();
    // @ts-expect-error 'NotARealEvent' is not in the registry
    bus.subscribe('NotARealEvent', () => undefined);
    // @ts-expect-error name must be a registry key, payload must match
    bus.publish({ name: 'NotARealEvent', occurredAt: '', payload: {} });
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
      payload: samplePayload(),
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
      payload: samplePayload(),
    });
    expect(seen).toHaveLength(0);
  });
});
