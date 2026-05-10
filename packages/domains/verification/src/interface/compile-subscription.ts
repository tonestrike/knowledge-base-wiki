import { type WikiId, lintRunId, wikiId } from '@package/contracts/shared';
import type { EventBus } from '@package/shared-kernel';
import type { VerificationDeps } from '../application/ports.ts';

// Subscribes to the wiki context's CompileFinished event and auto-triggers a
// LintRun for the affected Wiki. Returns the unsubscribe function.
export const subscribeCompileFinished = (
  deps: Pick<VerificationDeps, 'newId' | 'dispatcher'>,
  bus: EventBus,
): (() => void) =>
  bus.subscribe('CompileFinished', async (event) => {
    const payload = event.payload as { wikiId?: string };
    if (!payload?.wikiId) return;
    const targetWiki: WikiId = wikiId(payload.wikiId);
    const id = lintRunId(deps.newId());
    await deps.dispatcher.start({ lintRunId: id, wikiId: targetWiki });
  });
