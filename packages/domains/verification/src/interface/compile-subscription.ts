import { type WikiId, lintRunId, wikiId } from '@package/contracts/shared';
import type { EventBus } from '@package/shared-kernel';
import type { VerificationDeps } from '../application/ports.ts';

// Subscribes to the wiki context's CompileFinished event and auto-triggers a
// LintRun for the affected Wiki. Returns the unsubscribe function.
//
// TODO(cross-PR with #7): tighten `event.payload as { wikiId?: string }` once
// the shared-kernel EventBus becomes registry-typed (see PR #7 type-design
// finding on EventBus payload `unknown`).
export const subscribeCompileFinished = (
  deps: Pick<VerificationDeps, 'newId' | 'dispatcher'>,
  bus: EventBus,
): (() => void) =>
  bus.subscribe('CompileFinished', async (event) => {
    // TODO(cross-PR with #7): replace `as { wikiId?: string }` with the typed
    // payload once shared-kernel EventBus is registry-typed.
    const payload = event.payload as { wikiId?: string };
    if (!payload?.wikiId) return;
    const targetWiki: WikiId = wikiId(payload.wikiId);
    const id = lintRunId(deps.newId());
    try {
      await deps.dispatcher.start({ lintRunId: id, wikiId: targetWiki });
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
