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
  // CompileFinished — wiki context emits when a CompileRun completes;
  // verification subscribes to auto-trigger a LintRun for the affected Wiki.
  // pageCount surfaces alongside finishedAt so downstream consumers can size
  // the lint run without a follow-up read.
  CompileFinished: {
    compileRunId: string;
    wikiId: string;
    finishedAt: string;
    pageCount: number;
  };
  LintRunFinished: {
    lintRunId: string;
    wikiId: string;
    finishedAt: string;
    findingCount: number;
  };
  LintRunFailed: {
    lintRunId: string;
    wikiId: string;
    failureMessage: string;
    failedAt: string;
  };
  // CorrectionAccepted — emitted when a user applies a Correction; wiki
  // context's handler patches the WikiPage paragraph (eventually consistent).
  CorrectionAccepted: {
    lintFindingId: string;
    wikiPageId: string;
    replacementText: string;
    acceptedAt: string;
  };
  // AnswerProduced — chat context emits this after a Turn finishes. The
  // wiki context's cross-context subscriber may file the Answer as an
  // AnswerPage (v1.1 stub today). Payload shape mirrors the contract-level
  // `AnswerProduced` envelope in `@package/contracts/events`; we keep the
  // ids as plain `string` here so shared-kernel doesn't take a runtime
  // dependency on the contracts package.
  AnswerProduced: {
    conversationId: string;
    turnId: string;
    wikiId: string;
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
