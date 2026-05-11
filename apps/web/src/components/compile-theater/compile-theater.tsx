import type { CompileEvent } from '@package/contracts/wiki';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BookOpenIcon,
  BrainIcon,
  CheckCircle2Icon,
  CompassIcon,
  FilesIcon,
  LinkIcon,
  PenLineIcon,
  SearchIcon,
  SparklesIcon,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { orpc } from '../../lib/orpc.ts';
import { ErrorState } from '../states/error.tsx';
import { useCompileStream } from './use-compile-stream.ts';

/** Cap on visible AgentThought lines surfaced in the strip. */
const MAX_VISIBLE_THOUGHTS = 6;

/** Phase ordering — drives the progress meter and the central stage. */
const PHASES = [
  { id: 'starting', label: 'Warming up', Icon: SparklesIcon },
  { id: 'reading', label: 'Reading sources', Icon: BookOpenIcon },
  { id: 'schema', label: 'Inferring schema', Icon: CompassIcon },
  { id: 'drafting', label: 'Drafting pages', Icon: PenLineIcon },
  { id: 'linking', label: 'Resolving links', Icon: LinkIcon },
  { id: 'indexing', label: 'Building indexes', Icon: FilesIcon },
  { id: 'finished', label: 'Compiled', Icon: CheckCircle2Icon },
] as const;
type PhaseId = (typeof PHASES)[number]['id'];

const derivePhase = (events: CompileEvent[]): PhaseId => {
  if (events.some((e) => e.kind === 'CompileFinished')) return 'finished';
  if (events.some((e) => e.kind === 'IndexBuilt')) return 'indexing';
  // The Linker's BacklinkResolved is the strongest "linking" signal.
  if (events.some((e) => e.kind === 'BacklinkResolved')) return 'linking';
  if (events.some((e) => e.kind === 'PageDrafted')) return 'drafting';
  if (events.some((e) => e.kind === 'SchemaInferred')) {
    // After schema, we're either researching (reading) or drafting.
    // The Researcher's per-source "Reading <filename>" AgentThought
    // means we're in the read-and-extract phase; if drafting hasn't
    // started, treat it as research-in-progress (separate visual).
    const thoughts = events.filter((e) => e.kind === 'AgentThought');
    if (thoughts.some((t) => t.agent === 'Researcher')) return 'reading';
    return 'schema';
  }
  return 'starting';
};

export interface CompileTheaterProps {
  /** Compile run id to subscribe to. */
  compileRunId?: string | null;
  /** Optional retry callback. */
  onRetry?: () => void;
}

export function CompileTheater({ compileRunId = null, onRetry }: CompileTheaterProps) {
  const { events, error } = useCompileStream(compileRunId);
  const nav = useNavigate();
  const reduce = useReducedMotion();
  // Drives the full-page hand-off animation after CompileFinished.
  // 'idle' → 'flash' (white-out) → 'navigate'.
  const [transition, setTransition] = useState<'idle' | 'flash' | 'navigate'>('idle');

  const phase = derivePhase(events);
  const schemaEvent = events.find((e) => e.kind === 'SchemaInferred');
  const drafted = events.filter((e) => e.kind === 'PageDrafted');
  const compileStarted = events.find((e) => e.kind === 'CompileStarted');
  const compileFinished = events.find((e) => e.kind === 'CompileFinished');
  const indexBuilt = events.filter((e) => e.kind === 'IndexBuilt');
  const thoughts = events.filter((e) => e.kind === 'AgentThought');
  const lastThoughts = thoughts.slice(-MAX_VISIBLE_THOUGHTS);

  const sourceFilenames =
    compileStarted && compileStarted.kind === 'CompileStarted'
      ? (compileStarted.sourceFilenames ?? [])
      : [];

  // Per-source status derived from Researcher thoughts.
  const readerLines = thoughts
    .filter((t) => t.agent === 'Researcher' && t.message.startsWith('Reading '))
    .map((t) => t.message);
  const lastReader = readerLines.at(-1);
  const isPastResearch = events.some(
    (e) => e.kind === 'PageDrafted' || e.kind === 'IndexBuilt' || e.kind === 'CompileFinished',
  );

  const friendlyName = (raw: string) =>
    raw
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/^\d{4}[-_]\d{1,2}[-_]/, '')
      .replace(/[-_]/g, ' ');

  const sourceCards = (() => {
    if (!compileStarted || compileStarted.kind !== 'CompileStarted') return [];
    if (sourceFilenames.length === 0) {
      return Array.from({ length: compileStarted.sourceCount }, (_, i) => ({
        id: `${compileStarted.compileRunId}-${i}`,
        name: `Source ${i + 1}`,
        status: 'queued' as const,
      }));
    }
    return sourceFilenames.map((filename, i) => {
      const everRead = readerLines.some((line) => line.includes(filename));
      const isReading = !isPastResearch && lastReader?.includes(filename) === true;
      const status: 'queued' | 'reading' | 'done' = isReading
        ? 'reading'
        : everRead
          ? 'done'
          : 'queued';
      return {
        id: `${compileStarted.compileRunId}-${i}`,
        name: friendlyName(filename),
        status,
      };
    });
  })();

  // Once compile finishes we surface a hero flourish; the parent route
  // navigates to the wiki overview after a short pause so the user can
  // see the thesis + page count animate in.
  const wikiId = useMemo(() => {
    return compileFinished?.kind === 'CompileFinished'
      ? compileFinished.wikiId
      : (events.find((e) => e.kind === 'PageDrafted')?.compileRunId ?? null);
  }, [compileFinished, events]);

  // Auto-navigate to the wiki ~4s after CompileFinished. Stages:
  //   t=0:    CompileFinished arrives → CompletionHero animates in
  //   t=4s:   transition flips to 'flash' (white-out overlay sweeps in)
  //   t=5s:   transition flips to 'navigate' → router.push(/wiki/<id>)
  // The user can click "Open your wiki" earlier to skip the delay.
  useEffect(() => {
    if (transition !== 'idle' || !wikiId) return;
    if (!compileFinished || compileFinished.kind !== 'CompileFinished') return;
    const t1 = window.setTimeout(() => setTransition('flash'), 4000);
    return () => window.clearTimeout(t1);
  }, [compileFinished, wikiId, transition]);
  useEffect(() => {
    if (transition !== 'flash' || !wikiId) return;
    const t = window.setTimeout(() => {
      // Hold the overlay visually but switch state to 'navigate' so the
      // background layer is fully opaque BEFORE we change route. The
      // route swap unmounts this component, so AnimatePresence can't
      // play an exit — anything still visible at the moment of nav
      // becomes a hard cut. Going fully opaque just before nav avoids
      // the "white edge sliding away" flicker the user noticed.
      setTransition('navigate');
      window.setTimeout(() => {
        // No state seed on nav — see the comment above; this keeps the
        // wiki page from re-mounting the just-finished theater.
        nav(`/wiki/${wikiId}`);
      }, 220);
    }, 900);
    return () => window.clearTimeout(t);
  }, [transition, wikiId, nav]);

  return (
    <>
      {/* Full-page hand-off overlay. Renders as a fixed-position layer over
        the whole viewport (NOT inside the rounded section) so the animation
        feels like the page itself is dissolving into the wiki, not a card
        flash. Two acts: an accent-color sweep from center outward, then a
        white-out as the route swaps in. */}
      <AnimatePresence>
        {transition !== 'idle' ? (
          <motion.div
            key="compile-handoff"
            className="fixed inset-0 z-[100] pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <motion.div
              className="absolute inset-0 bg-accent"
              initial={{ clipPath: 'circle(0% at 50% 50%)' }}
              animate={{ clipPath: 'circle(150% at 50% 50%)' }}
              transition={{ duration: 0.9, ease: [0.65, 0, 0.35, 1] }}
            />
            <motion.div
              className="absolute inset-0 bg-background"
              initial={{ opacity: 0 }}
              animate={{ opacity: transition === 'navigate' ? 1 : 0 }}
              transition={{ duration: 0.22, ease: 'easeInOut' }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <section className="relative overflow-hidden rounded-2xl border border-border/40 bg-gradient-to-b from-background via-background to-accent/[0.02]">
        {!reduce ? <AmbientField active={phase !== 'finished'} /> : null}

        {/* Error banner */}
        {error ? (
          <div className="relative z-10 p-5">
            <ErrorState message={`Compile stream failed: ${error}`} onRetry={onRetry} />
          </div>
        ) : null}

        {/* Hero phase pill */}
        <div className="relative z-10 px-6 pt-5">
          <PhaseRibbon
            phase={phase}
            pageCount={drafted.length}
            sourceCount={sourceCards.length}
            schemaTypes={
              schemaEvent && schemaEvent.kind === 'SchemaInferred'
                ? schemaEvent.schema.pageTypes.length
                : 0
            }
            indexCount={indexBuilt.length}
          />
        </div>

        {/* Central stage. Grid rows stretch to the tallest column by default;
          `auto-rows-min` + `items-start` lets each lane be its own height so
          the empty middle doesn't push the page footer way down. */}
        <div className="relative z-10 grid auto-rows-min grid-cols-1 items-start gap-6 px-6 pt-5 pb-6 lg:grid-cols-[260px_1fr_320px]">
          {/* Left: sources */}
          <div className="space-y-2">
            <LaneLabel icon={<BookOpenIcon className="size-3" />} label="Sources" />
            <AnimatePresence>
              {sourceCards.map((s, i) => (
                <SourceCardCine key={s.id} name={s.name} status={s.status} idx={i} />
              ))}
            </AnimatePresence>
            {sourceCards.length === 0 ? (
              <p className="font-mono text-[11px] text-muted-foreground/60">
                Awaiting CompileStarted…
              </p>
            ) : null}
          </div>

          {/* Center: stage with phase-aware visual. No fixed height — the
            stage itself decides how much vertical room it needs, so the
            page is compact while reading/schema (just the orb) and only
            grows during drafting when there's actual content to show. */}
          <div className="relative flex flex-col items-center justify-start pt-8 lg:pt-20">
            <AnimatePresence mode="wait">
              {phase === 'starting' || phase === 'reading' || phase === 'schema' ? (
                <CoreOrb
                  key="core"
                  phase={phase}
                  schema={
                    schemaEvent?.kind === 'SchemaInferred'
                      ? schemaEvent.schema.pageTypes
                      : undefined
                  }
                />
              ) : phase === 'drafting' ? (
                <DraftingConstellation key="draft" drafted={drafted} />
              ) : phase === 'linking' || phase === 'indexing' ? (
                <LinkingWeb
                  key="link"
                  drafted={drafted}
                  indexes={indexBuilt.map((e) => (e.kind === 'IndexBuilt' ? e.pageType : ''))}
                />
              ) : (
                <CompletionHero
                  key="done"
                  pageCount={drafted.length + indexBuilt.length}
                  wikiId={wikiId ?? undefined}
                  onContinue={(id) => nav(`/wiki/${id}`)}
                />
              )}
            </AnimatePresence>
          </div>

          {/* Right: pages — capped with overflow so the list never blows the
            page height; latest at top, older scroll-fade out the bottom. */}
          <div className="space-y-2">
            <LaneLabel
              icon={<PenLineIcon className="size-3" />}
              label={`Pages · ${drafted.length}`}
            />
            <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
              <AnimatePresence>
                {drafted
                  .slice()
                  .reverse()
                  .map((e, i) => (
                    <PageCardCine key={e.pageId} event={e} idx={i} />
                  ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Bottom thought strip */}
        <div className="relative z-10 border-t border-border/40 bg-background/40 px-8 py-4 backdrop-blur-sm">
          <LaneLabel icon={<BrainIcon className="size-3" />} label="Live narration" />
          {/* Vertical stack — newest at the bottom, older lines fade as more
            arrive. Drops the previous `layout` motion + grid layout that
            caused chips to overlap on entrance/exit. The fixed-height
            container with overflow-hidden + flex-col + bottom-anchor
            means the latest line is always at the visual baseline, and
            new lines push older ones up smoothly. */}
          <div className="mt-2 flex h-[88px] flex-col-reverse gap-1 overflow-hidden">
            <AnimatePresence initial={false}>
              {[...lastThoughts]
                .reverse()
                .filter(
                  (t): t is Extract<CompileEvent, { kind: 'AgentThought' }> =>
                    t.kind === 'AgentThought',
                )
                .map((t, i) => (
                  <ThoughtChip
                    key={`${t.compileRunId}-${thoughts.indexOf(t)}-${t.message.slice(0, 24)}`}
                    agent={t.agent}
                    message={t.message}
                    fresh={i === 0}
                  />
                ))}
            </AnimatePresence>
            {lastThoughts.length === 0 ? (
              <p className="font-mono text-[11px] text-muted-foreground/60">
                The pipeline will narrate itself here as the agents work…
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </>
  );
}

// ─── PhaseRibbon ──────────────────────────────────────────────────────────────

function PhaseRibbon({
  phase,
  pageCount,
  sourceCount,
  schemaTypes,
  indexCount,
}: {
  phase: PhaseId;
  pageCount: number;
  sourceCount: number;
  schemaTypes: number;
  indexCount: number;
}) {
  const currentIdx = PHASES.findIndex((p) => p.id === phase);
  const stats =
    phase === 'reading'
      ? `${sourceCount} sources`
      : phase === 'schema'
        ? `${schemaTypes || '…'} page types`
        : phase === 'drafting'
          ? `${pageCount} drafted`
          : phase === 'linking'
            ? `${pageCount} pages`
            : phase === 'indexing'
              ? `${indexCount} indexes`
              : phase === 'finished'
                ? `${pageCount} pages`
                : '';
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <motion.div
          key={phase}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 20 }}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-accent shadow-[0_0_24px_-6px_var(--accent)]"
        >
          {(() => {
            const PhaseIcon = PHASES[currentIdx]?.Icon ?? SparklesIcon;
            return <PhaseIcon className="size-5" />;
          })()}
        </motion.div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent/80">
            Compile in progress
          </p>
          <p className="font-serif text-2xl tracking-tight">{PHASES[currentIdx]?.label ?? '—'}</p>
        </div>
      </div>
      <div className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {stats}
      </div>
      <div className="flex w-full items-center gap-2">
        {PHASES.map((p, i) => {
          const past = i < currentIdx;
          const active = i === currentIdx;
          return (
            <motion.div
              key={p.id}
              className={`relative h-1 flex-1 overflow-hidden rounded-full ${
                past ? 'bg-accent/70' : active ? 'bg-accent/30' : 'bg-border/40'
              }`}
              initial={false}
              animate={{ opacity: active ? 1 : past ? 0.9 : 0.6 }}
            >
              {active ? (
                <motion.div
                  aria-hidden
                  className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-accent to-transparent"
                  initial={{ x: 0 }}
                  animate={{ x: '400%' }}
                  transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.6, ease: 'linear' }}
                />
              ) : null}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Lane label helper ────────────────────────────────────────────────────────

function LaneLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-accent/80">
      <span className="text-accent">{icon}</span>
      {label}
    </div>
  );
}

// ─── Source cards ─────────────────────────────────────────────────────────────

function SourceCardCine({
  name,
  status,
  idx,
}: {
  name: string;
  status: 'queued' | 'reading' | 'done';
  idx: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: idx * 0.04, type: 'spring', stiffness: 200, damping: 22 }}
      className={`relative overflow-hidden rounded-lg border px-3 py-2.5 text-sm transition-all ${
        status === 'reading'
          ? 'border-accent bg-accent/10 shadow-[0_0_28px_-4px_var(--accent)]'
          : status === 'done'
            ? 'border-accent/30 bg-accent/5'
            : 'border-border/60 bg-card/30'
      }`}
    >
      {status === 'reading' && !reduce ? (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-accent/30 to-transparent"
          animate={{ x: ['0%', '300%'] }}
          transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.8, ease: 'linear' }}
        />
      ) : null}
      <div className="relative flex items-center gap-2">
        <span
          className={`size-1.5 shrink-0 rounded-full ${
            status === 'reading'
              ? 'bg-accent shadow-[0_0_8px_var(--accent)]'
              : status === 'done'
                ? 'bg-accent/60'
                : 'bg-muted-foreground/30'
          }`}
        />
        <span className="flex-1 truncate font-medium">{name}</span>
        {status === 'reading' ? (
          <motion.span
            className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-accent"
            animate={reduce ? undefined : { opacity: [0.5, 1, 0.5] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 1.4, ease: 'easeInOut' }}
          >
            reading
          </motion.span>
        ) : null}
      </div>
    </motion.div>
  );
}

// ─── Page cards ───────────────────────────────────────────────────────────────

function PageCardCine({
  event,
  idx,
}: {
  event: Extract<CompileEvent, { kind: 'PageDrafted' }>;
  idx: number;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 16, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 16 }}
      transition={{ delay: idx * 0.02, type: 'spring', stiffness: 220, damping: 22 }}
      className="rounded-lg border border-accent/40 bg-accent/[0.04] px-3 py-2"
    >
      <p className="font-mono text-[9px] uppercase tracking-widest text-accent/80">
        {event.pageType ?? event.subtype}
      </p>
      <p className="mt-0.5 line-clamp-2 font-serif text-sm leading-snug">{event.title}</p>
    </motion.div>
  );
}

// ─── Central stages ───────────────────────────────────────────────────────────

function CoreOrb({
  phase,
  schema,
}: {
  phase: PhaseId;
  schema?: ReadonlyArray<{ name: string; description: string }>;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 180, damping: 22 }}
      className="relative flex flex-col items-center justify-center"
    >
      <div className="relative flex h-56 w-56 items-center justify-center">
        {/* Outer ring */}
        <motion.div
          className="absolute inset-0 rounded-full border border-accent/30"
          animate={reduce ? undefined : { rotate: 360 }}
          transition={{ repeat: Number.POSITIVE_INFINITY, duration: 18, ease: 'linear' }}
        />
        <motion.div
          className="absolute inset-4 rounded-full border border-accent/40"
          animate={reduce ? undefined : { rotate: -360 }}
          transition={{ repeat: Number.POSITIVE_INFINITY, duration: 26, ease: 'linear' }}
        />
        {/* Core */}
        <motion.div
          className="relative flex h-32 w-32 items-center justify-center rounded-full bg-accent/15 shadow-[0_0_60px_-10px_var(--accent)]"
          animate={reduce ? undefined : { scale: [1, 1.06, 1] }}
          transition={{ repeat: Number.POSITIVE_INFINITY, duration: 2.4, ease: 'easeInOut' }}
        >
          {phase === 'schema' ? (
            <CompassIcon className="size-12 text-accent" />
          ) : phase === 'reading' ? (
            <SearchIcon className="size-12 text-accent" />
          ) : (
            <SparklesIcon className="size-12 text-accent" />
          )}
        </motion.div>
      </div>
      <motion.p
        key={phase}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-8 max-w-md text-center font-serif text-lg leading-snug text-muted-foreground"
      >
        {phase === 'starting'
          ? "Listening for the orchestrator's first events…"
          : phase === 'reading'
            ? 'Reading every source for findings — one structured pass per page type.'
            : 'A schema is forming. The wiki will be organized around these page types:'}
      </motion.p>
      {schema && phase === 'schema' ? (
        <motion.div
          className="mt-4 flex flex-wrap justify-center gap-2"
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
        >
          {schema.map((pt) => (
            <motion.span
              key={pt.name}
              variants={{
                hidden: { opacity: 0, scale: 0.6 },
                visible: { opacity: 1, scale: 1 },
              }}
              transition={{ type: 'spring', stiffness: 240, damping: 18 }}
              className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs text-accent"
            >
              {pt.name}
            </motion.span>
          ))}
        </motion.div>
      ) : null}
    </motion.div>
  );
}

function DraftingConstellation({
  drafted,
}: {
  drafted: Array<Extract<CompileEvent, { kind: 'PageDrafted' }>>;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // Caption-above-grid layout. Prior version absolute-positioned the
      // caption at the bottom; as pages streamed in and the grid grew
      // taller, the caption visibly jumped each row. Stacking the
      // caption ABOVE the grid in normal flow pins it to a stable slot
      // — the grid expands downward without moving the label.
      className="relative flex w-full flex-col items-center gap-4 py-8"
    >
      <motion.div aria-hidden className="-z-10 absolute inset-0 flex items-center justify-center">
        <motion.div
          className="h-40 w-40 rounded-full bg-accent/10 blur-3xl"
          animate={reduce ? undefined : { scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4] }}
          transition={{ repeat: Number.POSITIVE_INFINITY, duration: 3, ease: 'easeInOut' }}
        />
      </motion.div>
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        Crystallizing pages from the corpus…
      </p>
      <div className="relative grid grid-cols-3 gap-3">
        <AnimatePresence>
          {drafted.slice(-9).map((e, i) => (
            <motion.div
              key={e.pageId}
              layout
              initial={{ opacity: 0, scale: 0.4, rotate: -8 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.4 }}
              transition={{
                delay: i * 0.04,
                type: 'spring',
                stiffness: 220,
                damping: 22,
              }}
              className="w-32 rounded-lg border border-accent/40 bg-card/60 p-2 shadow-[0_0_20px_-8px_var(--accent)] backdrop-blur"
            >
              <p className="font-mono text-[9px] uppercase tracking-widest text-accent/80">
                {e.pageType ?? e.subtype}
              </p>
              <p className="mt-0.5 line-clamp-2 font-serif text-xs leading-snug">{e.title}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function LinkingWeb({
  drafted,
  indexes,
}: {
  drafted: Array<Extract<CompileEvent, { kind: 'PageDrafted' }>>;
  indexes: string[];
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex min-h-[320px] w-full items-center justify-center py-8"
    >
      <motion.div
        className="absolute h-72 w-72 rounded-full border border-accent/30"
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ repeat: Number.POSITIVE_INFINITY, duration: 24, ease: 'linear' }}
      />
      <motion.div
        className="absolute flex h-24 w-24 items-center justify-center rounded-full bg-accent/15 shadow-[0_0_60px_-10px_var(--accent)]"
        animate={reduce ? undefined : { scale: [1, 1.08, 1] }}
        transition={{ repeat: Number.POSITIVE_INFINITY, duration: 2.2, ease: 'easeInOut' }}
      >
        <LinkIcon className="size-10 text-accent" />
      </motion.div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="grid grid-cols-2 gap-x-32 gap-y-4 sm:gap-x-48">
          {drafted.slice(0, 8).map((e, i) => (
            <motion.div
              key={e.pageId}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 0.9, scale: 1 }}
              transition={{ delay: i * 0.06, type: 'spring', stiffness: 200, damping: 22 }}
              className="rounded-md border border-accent/30 bg-card/50 px-2.5 py-1.5 font-serif text-xs backdrop-blur"
            >
              {e.title}
            </motion.div>
          ))}
        </div>
      </div>
      <p className="absolute bottom-0 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {indexes.length > 0
          ? `Linking ${drafted.length} pages and building ${indexes.length} indexes…`
          : `Resolving backlinks across ${drafted.length} pages…`}
      </p>
    </motion.div>
  );
}

function CompletionHero({
  pageCount,
  wikiId,
  onContinue,
}: {
  pageCount: number;
  wikiId?: string;
  onContinue: (wikiId: string) => void;
}) {
  const { data: wiki } = useQuery({
    ...orpc.wiki.getWiki.queryOptions({ input: { id: wikiId ?? '' } }),
    enabled: !!wikiId,
  });
  const thesis = wiki?.schema.thesis;
  const glossaryCount = wiki?.schema.glossary?.length ?? 0;
  const [counted, setCounted] = useState(0);
  const countTargetRef = useRef(pageCount);
  countTargetRef.current = pageCount;
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1200);
      setCounted(Math.round(t * countTargetRef.current));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 180, damping: 20 }}
      className="flex w-full flex-col items-center text-center"
    >
      <motion.div
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18, delay: 0.05 }}
        className="flex h-20 w-20 items-center justify-center rounded-full bg-accent/20 text-accent shadow-[0_0_60px_-10px_var(--accent)]"
      >
        <CheckCircle2Icon className="size-12" />
      </motion.div>
      <motion.h2
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.18 }}
        className="mt-6 font-serif text-4xl tracking-tight"
      >
        Wiki compiled
      </motion.h2>
      <motion.p
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.28 }}
        className="mt-2 font-mono text-xs uppercase tracking-[0.3em] text-accent/70"
      >
        {counted} pages · {glossaryCount} glossary terms
      </motion.p>
      {thesis ? (
        <motion.p
          initial={{ y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-6 max-w-xl text-balance font-serif text-lg leading-relaxed text-muted-foreground"
        >
          {thesis}
        </motion.p>
      ) : null}
      <motion.button
        type="button"
        onClick={() => wikiId && onContinue(wikiId)}
        disabled={!wikiId}
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.55 }}
        className="mt-8 group inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-6 py-3 font-mono text-xs uppercase tracking-[0.25em] text-accent-foreground shadow-[0_0_30px_-6px_var(--accent)] transition-transform hover:-translate-y-0.5 disabled:opacity-50"
      >
        Open your wiki
        <span aria-hidden className="transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </motion.button>
    </motion.div>
  );
}

// ─── Thought chip + ambient field ─────────────────────────────────────────────

const AGENT_COLOR: Record<string, string> = {
  Compiler: 'text-foreground',
  SchemaInferrer: 'text-amber-400',
  Researcher: 'text-emerald-400',
  Drafter: 'text-violet-400',
  Linker: 'text-sky-400',
  IndexBuilder: 'text-rose-300',
};

function ThoughtChip({
  agent,
  message,
  fresh,
}: {
  agent: string;
  message: string;
  fresh: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      className={`flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-xs leading-snug ${
        fresh
          ? 'border-accent/40 bg-accent/[0.04] shadow-[0_0_18px_-8px_var(--accent)]'
          : 'border-border/30 bg-card/20'
      }`}
    >
      <span
        className={`shrink-0 font-mono text-[9px] uppercase tracking-wider ${AGENT_COLOR[agent] ?? 'text-muted-foreground'}`}
      >
        {agent}
      </span>
      <span className="truncate text-muted-foreground">{message}</span>
    </motion.div>
  );
}

function AmbientField({ active }: { active: boolean }) {
  // Pure CSS gradient + animated mesh. No DOM-heavy particle system — keeps
  // the background pretty without burning frames on a long compile.
  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        animate={
          active
            ? {
                backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'],
              }
            : undefined
        }
        transition={{ repeat: Number.POSITIVE_INFINITY, duration: 18, ease: 'easeInOut' }}
        style={{
          backgroundImage:
            'radial-gradient(ellipse at 20% 10%, var(--accent), transparent 60%), radial-gradient(ellipse at 80% 90%, color-mix(in oklab, var(--accent), white 30%), transparent 55%)',
          backgroundSize: '200% 200%',
          backgroundBlendMode: 'screen',
          filter: 'blur(80px)',
          opacity: 0.07,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,_var(--accent),_transparent_60%)] opacity-[0.06]"
      />
    </>
  );
}
