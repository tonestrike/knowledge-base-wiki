import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { ErrorState } from '../states/error.tsx';
import { AgentLane } from './agent-lane.tsx';
import { DraftingGhost } from './drafting-ghost.tsx';
import { EmergingPage } from './emerging-page.tsx';
import { SourceCard } from './source-card.tsx';
import { ThoughtLine } from './thought-line.tsx';
import { useCompileStream } from './use-compile-stream.ts';

/** Cap on visible AgentThought lines so a long compile doesn't grow the
 *  DOM unbounded. The scroll stays pinned to the newest line. */
const MAX_VISIBLE_THOUGHTS = 80;

export interface CompileTheaterProps {
  /**
   * Compile run id to subscribe to. When null, the theater renders
   * empty lanes (used by routes that haven't kicked off a compile yet).
   * The design-system route passes a fixture id and the LiveModeProvider
   * toggles between SSE and in-process iterable consumption.
   */
  compileRunId?: string | null;
  /**
   * Optional retry callback wired by the parent (e.g. WikiRoute). Without
   * it the error banner still renders but only as a notice.
   */
  onRetry?: () => void;
}

export function CompileTheater({ compileRunId = null, onRetry }: CompileTheaterProps) {
  const { events, error } = useCompileStream(compileRunId);
  const schemaEvent = events.find((e) => e.kind === 'SchemaInferred');
  const drafted = events.filter((e) => e.kind === 'PageDrafted');
  const compileStarted = events.find((e) => e.kind === 'CompileStarted');
  const thoughts = events.filter((e) => e.kind === 'AgentThought').slice(-MAX_VISIBLE_THOUGHTS);
  const thoughtsScrollRef = useRef<HTMLDivElement | null>(null);
  // Pin the agent-thoughts scroll to the newest line. Each emit grows the
  // list by one; we scroll to the bottom on every change so the most
  // recent narrative is always in view. The ref read is intentionally
  // outside the dep array — only `thoughts.length` should re-run this.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ref deref isn't a tracked dep.
  useEffect(() => {
    const el = thoughtsScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thoughts.length]);
  // Render real filenames from CompileStarted when the new pipeline supplied
  // them; fall back to positional placeholders for old fixtures / streams
  // that pre-date the `sourceFilenames` field. We strip the `.pdf` suffix
  // and any leading date prefix (`2024-01_`) so the card labels stay
  // readable in the narrow Sources lane.
  const friendlySourceName = (raw: string): string => {
    const base = raw.replace(/\.[a-z0-9]+$/i, '');
    const stripped = base.replace(/^\d{4}[-_]\d{1,2}[-_]/, '');
    return stripped.replace(/[-_]/g, ' ');
  };
  const sourceFilenames =
    compileStarted && compileStarted.kind === 'CompileStarted'
      ? (compileStarted.sourceFilenames ?? [])
      : [];
  // Compute per-source status from the AgentThought stream:
  //   queued  → no Researcher thought has mentioned this source yet
  //   reading → the LATEST "Reading <filename>" thought is this source
  //   done    → an older "Reading <filename>" thought referenced this
  //             source AND a newer one referenced something else (or
  //             we've left the Researcher phase entirely).
  // The Researcher emits one thought per source like
  // `Reading 2024-12_alignment-faking.pdf for Paper, Phenomenon, …`,
  // so the filename appears verbatim near the start of the message.
  const readerLines = thoughts
    .filter((t) => t.agent === 'Researcher' && t.message.startsWith('Reading '))
    .map((t) => t.message);
  const lastReader = readerLines.at(-1);
  const isPastResearch = events.some(
    (e) => e.kind === 'PageDrafted' || e.kind === 'IndexBuilt' || e.kind === 'CompileFinished',
  );
  const sourceCards =
    compileStarted && compileStarted.kind === 'CompileStarted'
      ? sourceFilenames.length > 0
        ? sourceFilenames.map((filename, i) => {
            const everRead = readerLines.some((line) => line.includes(filename));
            const isReading = !isPastResearch && lastReader?.includes(filename) === true;
            const status: 'queued' | 'reading' | 'done' = isReading
              ? 'reading'
              : everRead
                ? 'done'
                : 'queued';
            return {
              id: `${compileStarted.compileRunId}-${i}`,
              name: friendlySourceName(filename),
              status,
            };
          })
        : Array.from({ length: compileStarted.sourceCount }, (_, i) => ({
            id: `${compileStarted.compileRunId}-${i}`,
            name: `Source ${i + 1}`,
            status: 'queued' as const,
          }))
      : [];

  return (
    <section className="mt-8 space-y-6">
      {/* SF3 — propagate stream errors instead of leaving the lanes
          empty when a CompileFailed event arrives or the SSE drops. */}
      {error ? <ErrorState message={`Compile stream failed: ${error}`} onRetry={onRetry} /> : null}
      <AnimatePresence>
        {schemaEvent && schemaEvent.kind === 'SchemaInferred' ? (
          <motion.div
            key="schema-reveal"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            className="rounded-lg border border-accent bg-accent/5 px-5 py-4 text-sm shadow-xs"
          >
            <p className="font-mono text-xs uppercase tracking-widest text-accent">
              Schema inferred
            </p>
            <p className="mt-1 font-serif text-base leading-snug">{schemaEvent.reason}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {schemaEvent.schema.pageTypes.map((p) => (
                <motion.li
                  key={p.name}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 220, damping: 22 }}
                  className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 font-mono text-[11px] text-accent"
                >
                  {p.name}
                </motion.li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid grid-cols-3 gap-6">
        <AgentLane name="Sources">
          <AnimatePresence>
            {sourceCards.map((s) => (
              <SourceCard key={s.id} id={s.id} name={s.name} status={s.status} />
            ))}
          </AnimatePresence>
        </AgentLane>
        <AgentLane name="Agents">
          {thoughts.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              SchemaInferrer · Drafter · Linker · IndexBuilder
            </p>
          ) : (
            <div
              ref={thoughtsScrollRef}
              className="max-h-[380px] overflow-y-auto pr-1"
              aria-label="Agent thoughts"
              aria-live="polite"
            >
              <ul className="space-y-1.5">
                <AnimatePresence initial={false}>
                  {thoughts.map((t, i) => (
                    <ThoughtLine
                      // Index suffix lets the same agent emit two consecutive
                      // identical-message thoughts without React de-duping the
                      // motion entry. Tape order is canonical via i.
                      key={`${t.compileRunId}-${i}-${t.agent}-${t.message.slice(0, 40)}`}
                      thought={t}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          )}
        </AgentLane>
        <AgentLane name="Pages">
          <AnimatePresence>
            {drafted.map((e) => (
              <EmergingPage key={e.pageId} event={e} />
            ))}
            {/* Ghost cards for in-flight Drafter calls. The orchestrator
                emits one "Drafting <PageType> page from N findings…"
                AgentThought per Drafter dispatch. We count those, subtract
                the PageDrafted events that have already landed, and mount
                that many pulsing ghosts so the user sees the queue depth.
                Cap at 8 ghosts to keep the lane readable. */}
            {(() => {
              const draftThoughts = thoughts.filter(
                (t) => t.agent === 'Drafter' && t.message.startsWith('Drafting '),
              );
              const draftingTypes = draftThoughts
                .map((t) => /^Drafting\s+([A-Za-z]+)\s+page/.exec(t.message)?.[1])
                .filter((p): p is string => typeof p === 'string');
              // Subtract one ghost per PageDrafted of that type so the
              // ghost queue drains as real pages land.
              const remainingByType = new Map<string, number>();
              for (const t of draftingTypes) {
                remainingByType.set(t, (remainingByType.get(t) ?? 0) + 1);
              }
              for (const e of drafted) {
                const pt = e.pageType ?? e.subtype;
                if (!pt) continue;
                const left = remainingByType.get(pt) ?? 0;
                if (left > 0) remainingByType.set(pt, left - 1);
              }
              const ghosts: string[] = [];
              for (const [pt, n] of remainingByType.entries()) {
                for (let i = 0; i < n && ghosts.length < 8; i += 1) ghosts.push(`${pt}-${i}`);
              }
              return ghosts.map((k) => (
                <DraftingGhost key={`ghost-${k}`} pageType={k.split('-')[0] ?? ''} />
              ));
            })()}
          </AnimatePresence>
        </AgentLane>
      </div>
    </section>
  );
}
