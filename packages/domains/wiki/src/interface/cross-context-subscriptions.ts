import type { EventBus } from '@package/shared-kernel';

// Per spec §2.3, the wiki context subscribes to three cross-context events.
// In v1 we only WIRE the topology — the actual mutation paths for
// AnswerProduced (file an AnswerPage) and CorrectionAccepted (apply a Claim
// patch) are deliberate v1.1 stubs. The point of this v1 module is that
// flipping the handlers on later doesn't require rewiring the bus.

// SF9 — stubs are LOUD: they emit a structured warn() and (in non-prod
// envs) throw NotImplementedError so an integration test that expects a
// handler to do work fails immediately instead of "passing" against a
// silent log.
export class NotImplementedError extends Error {
  constructor(handler: string) {
    super(`[wiki] handler '${handler}' is a v1 stub and has not been implemented`);
    this.name = 'NotImplementedError';
  }
}

const isStrictMode = (): boolean => {
  // The Workers runtime exposes neither process.env nor a clean way to
  // read NODE_ENV; in apps/api the wiring sets WIKI_HANDLERS_STRICT='1'
  // to opt into the throw behavior in CI. Production stays soft so a
  // bug in 2.B doesn't take the whole event bus down.
  const g = globalThis as unknown as { WIKI_HANDLERS_STRICT?: string };
  return g.WIKI_HANDLERS_STRICT === '1';
};

const logUnimplemented = (handler: string, payload: unknown): void => {
  // Structured shape so a log aggregator can filter on `name`.
  console.warn('[wiki.unimplemented_handler]', { handler, payload });
  if (isStrictMode()) throw new NotImplementedError(handler);
};

export const subscribeWikiEvents = (bus: EventBus): Array<() => void> => {
  const u1 = bus.subscribe('SourceIngested', async (e) => {
    // v1.1 will mark the wiki as needing recompile and queue a CompileRun.
    logUnimplemented('SourceIngested', e.payload);
  });
  const u2 = bus.subscribe('AnswerProduced', async (e) => {
    // v1.1: file the Answer as an AnswerPage if the user opted in.
    logUnimplemented('AnswerProduced', e.payload);
  });
  const u3 = bus.subscribe('CorrectionAccepted', async (e) => {
    // v1.1: rewrite the Claim's text + attached citation.
    logUnimplemented('CorrectionAccepted', e.payload);
  });
  return [u1, u2, u3];
};
