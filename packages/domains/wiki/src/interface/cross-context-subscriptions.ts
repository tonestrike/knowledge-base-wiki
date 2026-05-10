import type { EventBus } from '@package/shared-kernel';

// Per spec §2.3, the wiki context subscribes to three cross-context events.
// In v1 we only WIRE the topology — the actual mutation paths for
// AnswerProduced (file an AnswerPage) and CorrectionAccepted (apply a Claim
// patch) are deliberate v1.1 stubs. The point of this v1 module is that
// flipping the handlers on later doesn't require rewiring the bus.

export const subscribeWikiEvents = (bus: EventBus): Array<() => void> => {
  const u1 = bus.subscribe('SourceIngested', async (e) => {
    // v1: incremental compile is wired but not driven — user-triggered
    // re-compile is the v1 path. v1.1 will mark the wiki as needing
    // recompile and queue a CompileRun.
    const payload = e.payload as { sourceId?: string };
    console.info('[wiki] SourceIngested received', { sourceId: payload.sourceId });
  });
  const u2 = bus.subscribe('AnswerProduced', async (e) => {
    // v1.1: file the Answer as an AnswerPage if the user opted in. For v1, log.
    console.info('[wiki] AnswerProduced received (would file AnswerPage)', e.payload);
  });
  const u3 = bus.subscribe('CorrectionAccepted', async (e) => {
    // v1.1: rewrite the Claim's text + attached citation. For v1, log.
    console.info('[wiki] CorrectionAccepted received (would patch Claim)', e.payload);
  });
  return [u1, u2, u3];
};
