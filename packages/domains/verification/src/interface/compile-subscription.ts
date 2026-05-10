import { type WikiId, lintRunId, wikiId } from '@package/contracts/shared';
import type { EventBus } from '@package/shared-kernel';
import type { VerificationDeps } from '../application/ports.ts';

// Subscribes to the wiki context's CompileFinished event and auto-triggers a
// LintRun for the affected Wiki. Returns the unsubscribe function.
//
// The shared-kernel EventBus is registry-typed (DomainEventMap), so the
// CompileFinished payload's wikiId / compileRunId / finishedAt fields are
// type-checked at the call site.
export const subscribeCompileFinished = (
  deps: Pick<VerificationDeps, 'newId' | 'lintDispatcher'>,
  bus: EventBus,
): (() => void) =>
  bus.subscribe('CompileFinished', async (event) => {
    const targetWiki: WikiId = wikiId(event.payload.wikiId);
    const id = lintRunId(deps.newId());
    try {
      await deps.lintDispatcher.start({ lintRunId: id, wikiId: targetWiki });
    } catch (err) {
      // The bus invokes handlers without a way to retry. Surface the failure
      // so it does not become an unhandled-promise warning. Auto-trigger is a
      // best-effort path; manual `verification.start` remains available. See
      // PR #6 silent-failure-hunter finding 6.
      console.error('[verification] auto-trigger LintRun failed', {
        wikiId: targetWiki,
        lintRunId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
