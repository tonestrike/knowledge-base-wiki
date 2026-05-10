// Minimal EventBus primitive for cross-context async coordination.
//
// `publish` accepts an event envelope { name, occurredAt, payload }; `subscribe`
// registers a handler keyed on the discriminator `name`. Returns an unsubscribe
// function. Implementations: InMemoryEventBus (tests + same-process v1), Cloudflare
// Queue adapter (production, in apps/api).

export interface DomainEventEnvelope<TName extends string = string, TPayload = unknown> {
  readonly name: TName;
  readonly occurredAt: string;
  readonly payload: TPayload;
}

export type EventHandler<TEvent extends DomainEventEnvelope = DomainEventEnvelope> = (
  event: TEvent,
) => void | Promise<void>;

export interface EventBus {
  publish(event: DomainEventEnvelope): Promise<void>;
  subscribe<TEvent extends DomainEventEnvelope>(
    name: TEvent['name'],
    handler: EventHandler<TEvent>,
  ): () => void;
}

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  readonly published: DomainEventEnvelope[] = [];

  async publish(event: DomainEventEnvelope): Promise<void> {
    this.published.push(event);
    const set = this.handlers.get(event.name);
    if (!set) return;
    for (const handler of set) {
      await handler(event);
    }
  }

  subscribe<TEvent extends DomainEventEnvelope>(
    name: TEvent['name'],
    handler: EventHandler<TEvent>,
  ): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as EventHandler);
    return () => {
      set?.delete(handler as EventHandler);
    };
  }
}
