import { AnimatePresence } from 'framer-motion';
import { AgentLane } from './agent-lane.tsx';
import { EmergingPage } from './emerging-page.tsx';
import { SourceCard } from './source-card.tsx';
import { useCompileStream } from './use-compile-stream.ts';

export function CompileTheater() {
  const events = useCompileStream();
  const schemaEvent = events.find((e) => e.kind === 'SchemaInferred');
  const drafted = events.filter((e) => e.kind === 'PageDrafted');
  const compileStarted = events.find((e) => e.kind === 'CompileStarted');
  // CompileStarted carries sourceCount; expand it into N source cards so the
  // "cards fly across with layoutId" moment (spec §4.3 #2) actually shows N
  // cards. Real per-Source events land in 2.A.
  const sourceCards =
    compileStarted && compileStarted.kind === 'CompileStarted'
      ? Array.from({ length: compileStarted.sourceCount }, (_, i) => ({
          id: `${compileStarted.compileRunId}-${i}`,
          name: `Source ${i + 1}`,
        }))
      : [];

  return (
    <section className="mt-8 space-y-6">
      {schemaEvent && schemaEvent.kind === 'SchemaInferred' ? (
        <div className="rounded-lg border border-accent bg-accent/5 px-4 py-3 text-sm">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Schema inferred</p>
          <p className="mt-1 font-serif text-base">{schemaEvent.reason}</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {schemaEvent.schema.pageTypes.map((p) => (
              <li key={p.name} className="rounded-full bg-accent/10 px-3 py-1 font-mono text-xs">
                {p.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
