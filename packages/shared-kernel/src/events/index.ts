// Domain-event registry.
//
// The bus is typed against a registry map of `{ EventName -> Payload }`.
// Misspelled event names fail compile; payload shape is enforced per name.
//
// Each bounded context's slice that introduces a new event extends
// `DomainEventMap` here. Slice 2.A owns `SourceIngested` /
// `SourceIngestionFailed`; slice 2.B owns `CompileFinished`. Slices 2.D /
// 3.x / chat will add their own entries (e.g. `CorrectionAccepted`,
// `AnswerProduced`) when their PRs land — until then, 2.B's cross-context
// subscribers register against the placeholder shapes below so flipping
// the handlers on doesn't require rewiring the bus.
export interface DomainEventMap {
  SourceIngested: {
    sourceId: string;
    folderId: string;
    contentHash: string;
    filename: string;
  };
  // SF3: a per-file failure event. Subscribers (telemetry, the ingest-event
  // tape in 3.1) classify ingestion errors instead of receiving an opaque
  // counter increment.
  SourceIngestionFailed: {
    folderId: string;
    driveFileId: string;
    reason: 'fetch' | 'extract' | 'storage' | 'persist' | 'unknown';
    message: string;
  };
  // 2.B — cross-context fan-out target for the verification pass.
  CompileFinished: {
    compileRunId: string;
    wikiId: string;
    pageCount: number;
  };
  // Placeholder shapes for v1.1 — subscribers register against these names
  // today as loud stubs (see wiki/cross-context-subscriptions.ts SF9). The
  // shapes will firm up when chat (2.C) and verification (2.D) land their
  // producer slices.
  AnswerProduced: {
    answerId: string;
    sessionId: string;
  };
  CorrectionAccepted: {
    claimId: string;
    correctedClaimText: string;
  };
}

export type DomainEventName = keyof DomainEventMap;

export interface DomainEventEnvelope<K extends DomainEventName = DomainEventName> {
  readonly name: K;
  readonly occurredAt: string;
  readonly payload: DomainEventMap[K];
}

export type EventHandler<K extends DomainEventName = DomainEventName> = (
  event: DomainEventEnvelope<K>,
) => void | Promise<void>;

export type Unsubscribe = () => void;

export interface EventBus {
  publish<K extends DomainEventName>(event: DomainEventEnvelope<K>): Promise<void>;
  subscribe<K extends DomainEventName>(name: K, handler: EventHandler<K>): Unsubscribe;
}

export class InMemoryEventBus implements EventBus {
  // Internally we erase the K — the public API still type-checks publish/subscribe
  // pairs. The cast on stored handlers is the only `unknown`-shaped escape hatch.
  private handlers = new Map<DomainEventName, Set<EventHandler>>();

  subscribe<K extends DomainEventName>(name: K, handler: EventHandler<K>): Unsubscribe {
    const set = this.handlers.get(name) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.handlers.set(name, set);
    return () => set.delete(handler as EventHandler);
  }

  async publish<K extends DomainEventName>(event: DomainEventEnvelope<K>): Promise<void> {
    const set = this.handlers.get(event.name);
    if (!set) return;
    for (const h of set) {
      try {
        await (h as EventHandler<K>)(event);
      } catch (err) {
        // The bus must not let one bad subscriber block the others.
        // Production bindings (e.g. Cloudflare Queue) DLQ on retry; in-memory swallows.
        console.error('[EventBus] subscriber threw', String(event.name), err);
      }
    }
  }
}
