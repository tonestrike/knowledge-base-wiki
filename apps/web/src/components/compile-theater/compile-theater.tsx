import { AnimatePresence, motion } from 'framer-motion';
import { AgentLane } from './agent-lane.tsx';
import { EmergingPage } from './emerging-page.tsx';
import { SourceCard } from './source-card.tsx';
import { useCompileStream } from './use-compile-stream.ts';

export interface CompileTheaterProps {
  /**
   * Compile run id to subscribe to. When null, the theater renders
   * empty lanes (used by routes that haven't kicked off a compile yet).
   * The design-system route passes a fixture id and the LiveModeProvider
   * toggles between SSE and in-process iterable consumption.
   */
  compileRunId?: string | null;
}

export function CompileTheater({ compileRunId = null }: CompileTheaterProps) {
  const { events } = useCompileStream(compileRunId);
  const schemaEvent = events.find((e) => e.kind === 'SchemaInferred');
  const drafted = events.filter((e) => e.kind === 'PageDrafted');
  const compileStarted = events.find((e) => e.kind === 'CompileStarted');
  const sourceCards =
    compileStarted && compileStarted.kind === 'CompileStarted'
      ? Array.from({ length: compileStarted.sourceCount }, (_, i) => ({
          id: `${compileStarted.compileRunId}-${i}`,
          name: `Source ${i + 1}`,
        }))
      : [];

  return (
    <section className="mt-8 space-y-6">
      <AnimatePresence>
        {schemaEvent && schemaEvent.kind === 'SchemaInferred' ? (
          <motion.div
            key="schema-reveal"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            className="rounded-lg border border-accent bg-accent/5 px-5 py-4 text-sm shadow-sm"
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
              <SourceCard key={s.id} id={s.id} name={s.name} />
            ))}
          </AnimatePresence>
        </AgentLane>
        <AgentLane name="Agents">
          <p className="font-mono text-xs text-muted-foreground">
            SchemaInferrer · Drafter · Linker · IndexBuilder
          </p>
        </AgentLane>
        <AgentLane name="Pages">
          <AnimatePresence>
            {drafted.map((e) => (
              <EmergingPage key={e.pageId} event={e} />
            ))}
          </AnimatePresence>
        </AgentLane>
      </div>
    </section>
  );
}
