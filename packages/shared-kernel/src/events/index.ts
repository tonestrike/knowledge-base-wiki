export interface DomainEventEnvelope<Name extends string = string, Payload = unknown> {
  readonly name: Name;
  readonly occurredAt: string;
  readonly payload: Payload;
}

export type EventHandler<E extends DomainEventEnvelope = DomainEventEnvelope> = (
  event: E,
) => void | Promise<void>;

export interface EventBus {
  publish<E extends DomainEventEnvelope>(event: E): Promise<void>;
  subscribe<Name extends string>(
    name: Name,
    handler: EventHandler<DomainEventEnvelope<Name>>,
  ): () => void;
}

export class InMemoryEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  subscribe<Name extends string>(
    name: Name,
    handler: EventHandler<DomainEventEnvelope<Name>>,
  ): () => void {
    const existing = this.handlers.get(name) ?? new Set<EventHandler>();
    existing.add(handler as EventHandler);
    this.handlers.set(name, existing);
    return () => existing.delete(handler as EventHandler);
  }

  async publish<E extends DomainEventEnvelope>(event: E): Promise<void> {
    const set = this.handlers.get(event.name);
    if (!set) return;
    for (const h of set) {
      try {
        await h(event);
      } catch (err) {
        // The bus must not let one bad subscriber block the others.
        // Production bindings (e.g. Cloudflare Queue) DLQ on retry; in-memory swallows.
        console.error('[EventBus] subscriber threw', event.name, err);
      }
    }
  }
}
