import type { LintRunId } from '@package/contracts/shared';
import type { LintEvent } from '@package/contracts/verification';
import type { EventBus, Tracer } from '@package/shared-kernel';
import { lintWiki } from '../application/lint-wiki.ts';
import type {
  AnthropicVerifier,
  ClaimReader,
  LintFindingRepository,
  LintRunDispatcher,
  LintRunRepository,
  LintRuntimeDeps,
  SourceTextReader,
} from '../application/ports.ts';

const TERMINAL_KINDS: ReadonlySet<LintEvent['kind']> = new Set([
  'LintRunFinished',
  'LintRunFailed',
]);

/**
 * In-process LintRunDispatcher backed by a per-lintRunId in-memory tape.
 * `start` kicks `lintWiki` and resolves immediately so the oRPC handler
 * doesn't block. The use-case writes findings + run rows to D1 as it goes;
 * the tape buffers the LintEvent stream so a slightly-late SSE subscriber
 * (the user clicks "Run audit" then the page renders the stream hook on the
 * next paint) sees every event.
 *
 * For the demo this lives in the api process. The production path is the
 * `LintRunDO` (see `cf-lint-run-dispatcher.ts`) which holds the same tape
 * per-DO-instance — same protocol, different persistence story.
 */
export const createInMemoryLintRunDispatcher = (deps: {
  verifier: AnthropicVerifier;
  claims: ClaimReader;
  sourceText: SourceTextReader;
  runs: LintRunRepository;
  findings: LintFindingRepository;
  eventBus: EventBus;
  newId: () => string;
  now: () => Date;
  concurrency?: number;
  /** Optional tracer threaded through to `lintWiki` for `lint.run` spans. */
  tracer?: Tracer;
}): LintRunDispatcher => {
  interface Tape {
    events: LintEvent[];
    waiters: Array<() => void>;
    finished: boolean;
  }
  const tapes = new Map<LintRunId, Tape>();
  const ensureTape = (id: LintRunId): Tape => {
    const t = tapes.get(id);
    if (t) return t;
    const fresh: Tape = { events: [], waiters: [], finished: false };
    tapes.set(id, fresh);
    return fresh;
  };

  return {
    async start({ lintRunId, wikiId }) {
      const tape = ensureTape(lintRunId);
      const runtimeDeps: LintRuntimeDeps = {
        ...deps,
        concurrency: deps.concurrency ?? 4,
        lintDispatcher: {} as LintRunDispatcher, // unused inside lintWiki
        async emit(event: LintEvent) {
          tape.events.push(event);
          if (TERMINAL_KINDS.has(event.kind)) tape.finished = true;
          const ws = tape.waiters.splice(0);
          for (const w of ws) w();
        },
      };

      // Fire and forget — start resolves immediately so the oRPC handler can
      // return the lintRunId. Errors are routed through the tape as a
      // LintRunFailed event so subscribers see the failure instead of an
      // un-terminated stream.
      lintWiki(runtimeDeps, { lintRunId, wikiId }).catch(async (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        await runtimeDeps.emit({ kind: 'LintRunFailed', lintRunId, message });
      });
    },
    async *subscribe(lintRunId) {
      const tape = ensureTape(lintRunId);
      let cursor = 0;
      while (true) {
        while (cursor < tape.events.length) {
          const ev = tape.events[cursor];
          cursor++;
          if (ev) yield ev;
        }
        if (tape.finished) return;
        await new Promise<void>((resolve) => tape.waiters.push(resolve));
      }
    },
  };
};
