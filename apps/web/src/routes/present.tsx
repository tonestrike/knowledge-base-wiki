import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';

/**
 * Presentation route — a non-technical talk explaining what tenex does
 * differently from a search engine. The Lord of the Rings metaphor
 * runs through the deck: same book, three readers (screenwriter,
 * philosopher, linguist) produce three radically different wikis.
 *
 * Keyboard nav: ← / → arrows, space, Page Up / Page Down, Home / End.
 * Click anywhere on the slide also advances.
 *
 * Why one file with inline slide content: the deck is short enough
 * (~14 slides) that scattering it across components hurts
 * scannability. Each slide is a React node returned by `slides[i]`.
 */

interface Slide {
  id: string;
  eyebrow?: string;
  render: () => ReactNode;
}

const SLIDES: ReadonlyArray<Slide> = [
  {
    id: 'title',
    render: () => (
      <Center>
        <Eyebrow>A talk in fourteen slides</Eyebrow>
        <Title>
          Don't search the document.
          <br />
          <Accent>Think through it.</Accent>
        </Title>
        <Sub>A different way to make sense of a pile of stuff.</Sub>
      </Center>
    ),
  },

  {
    id: 'setup',
    eyebrow: 'The setup',
    render: () => (
      <Stack>
        <Title>You have a pile of documents.</Title>
        <Body>
          PDFs. Papers. Meeting notes. Slack exports. Transcripts. Hundreds, maybe thousands of
          them.
        </Body>
        <Body>And then someone asks you a question.</Body>
      </Stack>
    ),
  },

  {
    id: 'three-readers',
    eyebrow: 'A thought experiment',
    render: () => (
      <Stack>
        <Title>
          Imagine three people are reading <Accent>The Lord of the Rings.</Accent>
        </Title>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
          <PersonCard
            who="A screenwriter"
            why="adapting it for film"
            tone="They want scenes, beats, dialogue, characters."
          />
          <PersonCard
            who="A philosopher"
            why="writing about power and language"
            tone="They want ideas about technology, sovereignty, the will."
          />
          <PersonCard
            who="A linguist"
            why="studying invented languages"
            tone="They want Quenya, Sindarin, naming patterns, etymologies."
          />
        </div>
      </Stack>
    ),
  },

  {
    id: 'three-notes',
    eyebrow: 'Same book — different notes',
    render: () => (
      <Stack>
        <Title>
          Three people read the same book.
          <br />
          <Accent>They take wildly different notes.</Accent>
        </Title>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <NotebookCard
            title="The screenwriter's notes"
            items={[
              'CHARACTERS: Frodo, Sam, Gollum',
              'SCENES: Council of Elrond, Shelob, Mount Doom',
              'BEATS: "I can\'t carry it for you. But I can carry you."',
              'STAGING: Long shadows; firelight; the eye',
            ]}
          />
          <NotebookCard
            title="The philosopher's notes"
            items={[
              'POWER: rings as objects that bear the will',
              'TECHNOLOGY: the forge; mastery vs corruption',
              'SOVEREIGNTY: stewardship vs. kingship',
              'LANGUAGE: what is named gains a hold',
            ]}
          />
          <NotebookCard
            title="The linguist's notes"
            items={[
              'QUENYA: high-elven; phonotactics from Finnish',
              'SINDARIN: grey-elven; Welsh consonant mutations',
              'BLACK SPEECH: stops, fricatives, no vowel harmony',
              'NAMING: -dor (land), -or (lord)',
            ]}
          />
        </div>
      </Stack>
    ),
  },

  {
    id: 'three-wikis',
    eyebrow: 'Same source, three wikis',
    render: () => (
      <Center>
        <Title>
          Three different wikis,
          <br />
          <Accent>from the same source text.</Accent>
        </Title>
        <Sub>None of them are wrong. They're answering different questions.</Sub>
      </Center>
    ),
  },

  {
    id: 'how-search-works',
    eyebrow: 'How search works today',
    render: () => (
      <Stack>
        <Title>
          You type <Accent>"ring"</Accent>.
        </Title>
        <Body>The system finds passages containing the word "ring."</Body>
        <Quote>
          "Three Rings for the Elven-kings under the sky…"
          <br />
          "Ring-wraiths of Mordor."
          <br />
          "The Ring went on a finger and stayed there."
        </Quote>
        <Sub>It's literal. It matches strings.</Sub>
      </Stack>
    ),
  },

  {
    id: 'how-semantic-works',
    eyebrow: 'Semantic search',
    render: () => (
      <Stack>
        <Title>
          Semantic search is fancier.
          <br />
          <Accent>It finds passages that mean "ring" — even when they don't say it.</Accent>
        </Title>
        <Body>"Circle." "Band." "Hoop." "The thing on his finger." All match.</Body>
        <Body className="text-muted-foreground">
          Under the hood: each passage gets a coordinate in a high-dimensional space. Similar
          meanings land near each other. The system finds the nearest neighbors of your query.
        </Body>
      </Stack>
    ),
  },

  {
    id: 'the-problem',
    eyebrow: 'The problem with both',
    render: () => (
      <Center>
        <Title>
          The screenwriter, the philosopher, the linguist — all three search <Accent>"ring"</Accent>
          .
        </Title>
        <Title className="text-accent">They get the same results.</Title>
        <Sub>Their perspective never enters the system.</Sub>
      </Center>
    ),
  },

  {
    id: 'what-if',
    eyebrow: 'A different question',
    render: () => (
      <Stack>
        <Title>What if the index itself had a point of view?</Title>
        <Body>
          What if, before you indexed the book at all, you told the system{' '}
          <Accent>who you are</Accent> and <Accent>what you're looking for</Accent>?
        </Body>
        <Body>And it built a wiki shaped by your question — not by the document's topics?</Body>
      </Stack>
    ),
  },

  {
    id: 'tenex',
    eyebrow: 'This is the idea behind Tenex',
    render: () => (
      <Stack>
        <Title>You drop in a folder.</Title>
        <Body className="text-foreground">You tell it:</Body>
        <div className="space-y-3 font-mono text-base text-muted-foreground md:text-lg">
          <PerspectiveLine>
            "I'm a screenwriter. Find me scenes, beats, characters."
          </PerspectiveLine>
          <PerspectiveLine>
            "I'm a founder. Find me business opportunities and unmet needs."
          </PerspectiveLine>
          <PerspectiveLine>
            "I'm a researcher. Find me claims, methods, and where the literature disagrees."
          </PerspectiveLine>
        </div>
        <Body>It builds a wiki shaped by your lens.</Body>
      </Stack>
    ),
  },

  {
    id: 'result',
    eyebrow: 'The result',
    render: () => (
      <Stack>
        <Title>
          Same folder. <Accent>Three perspectives. Three wikis.</Accent>
        </Title>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <WikiPreview
            label="As a screenwriter"
            sections={['Characters', 'Scenes', 'Beats', 'Settings']}
          />
          <WikiPreview
            label="As a founder"
            sections={['Opportunity', 'Pain', 'Wedge', 'Customer']}
          />
          <WikiPreview
            label="As a researcher"
            sections={['Claim', 'Method', 'Finding', 'Disagreement']}
          />
        </div>
        <Sub>The sections, the page titles, the prose — all shaped by the lens.</Sub>
      </Stack>
    ),
  },

  {
    id: 'agent-alternative',
    eyebrow: "The agent-loop alternative — why we don't do it",
    render: () => (
      <Stack>
        <Title>
          You could ask an AI to do this <Accent>per question.</Accent>
        </Title>
        <Body>
          Every time someone asks something, an agent loop kicks off: read the corpus, figure out
          what perspective the question implies, search again, re-interpret, finally answer.
        </Body>
        <Body className="text-muted-foreground">
          That works. It's also slow, expensive, and the agent has to{' '}
          <Accent>rebuild its understanding of the corpus from scratch</Accent> on every question.
        </Body>
      </Stack>
    ),
  },

  {
    id: 'move-it-upstream',
    eyebrow: 'The bet',
    render: () => (
      <Stack>
        <Title>
          Move the agent loop <Accent>upstream</Accent>.
        </Title>
        <Body>
          Pay the cost of <em>understanding the corpus from your perspective</em> ONCE, when you
          ingest it — not every time you ask a question.
        </Body>
        <Body>The wiki you get back already has the lens baked in.</Body>
      </Stack>
    ),
  },

  {
    id: 'cheap-questions',
    eyebrow: 'What this buys you',
    render: () => (
      <Stack>
        <Title>
          Cheap questions. <Accent>Deep answers.</Accent>
        </Title>
        <Body>
          The agent at chat time isn't reverse-engineering your perspective. It's just looking at a
          wiki that's already organized your way.
        </Body>
        <Body>
          Which means you can ask things you'd never ask a search engine.{' '}
          <Accent>"Trace the thread of deception across the corpus."</Accent> Or{' '}
          <Accent>"What are the three sharpest unmet needs here?"</Accent>
        </Body>
      </Stack>
    ),
  },

  {
    id: 'closing',
    render: () => (
      <Center>
        <Title>
          Don't search the document.
          <br />
          <Accent>Think through it.</Accent>
        </Title>
        <Sub className="mt-8">Tenex.</Sub>
      </Center>
    ),
  },
];

export function PresentRoute() {
  const [index, setIndex] = useState(0);
  const total = SLIDES.length;

  const goNext = useCallback(() => setIndex((i) => Math.min(i + 1, total - 1)), [total]);
  const goPrev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'Home') {
        setIndex(0);
      } else if (e.key === 'End') {
        setIndex(total - 1);
      } else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev, total]);

  const slide = SLIDES[index];
  if (!slide) return null;

  // Click-to-advance is implemented as a transparent button overlay
  // rather than a click handler on the wrapper — keeps the slide
  // content's own interactive elements (links, etc.) tappable AND
  // satisfies the keyboard-equivalence accessibility rule (keyboard
  // nav is handled at window level above).
  const handleClickToAdvance = (e: React.MouseEvent<HTMLButtonElement>) => {
    const x = e.clientX / window.innerWidth;
    if (x < 0.25) goPrev();
    else goNext();
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background text-foreground">
      <button
        type="button"
        aria-label="Advance slide (left third = previous, rest = next)"
        onClick={handleClickToAdvance}
        className="absolute inset-0 z-0 cursor-pointer bg-transparent"
      />
      {/* Slide content sits ABOVE the click overlay (z-10) so it's
          visible but its underlying button still receives the click. */}
      <AnimatePresence mode="wait">
        <motion.section
          key={slide.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
          className="pointer-events-none relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-8 py-16 md:px-16"
        >
          {slide.eyebrow ? (
            <p className="mb-8 font-mono text-[11px] uppercase tracking-[0.3em] text-accent">
              {slide.eyebrow}
            </p>
          ) : null}
          {slide.render()}
        </motion.section>
      </AnimatePresence>

      {/* Footer chrome: progress dots + slide counter + keyboard hint */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 flex flex-col items-center gap-3">
        <ProgressDots current={index} total={total} />
        <div className="flex items-center gap-6 font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
          <span>
            {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
          <span className="hidden md:inline">← → to navigate · F for fullscreen</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Slide primitives                                                    */
/* ------------------------------------------------------------------ */

function Center({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 text-center">{children}</div>
  );
}

function Stack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-8">{children}</div>;
}

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-muted-foreground">
      {children}
    </p>
  );
}

function Title({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <h1
      className={`max-w-5xl font-serif text-4xl leading-[1.1] tracking-tight md:text-6xl lg:text-7xl ${className}`}
    >
      {children}
    </h1>
  );
}

function Sub({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`max-w-3xl font-serif text-xl text-muted-foreground md:text-2xl ${className}`}>
      {children}
    </p>
  );
}

function Body({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`max-w-3xl text-lg leading-relaxed text-foreground/90 md:text-2xl md:leading-relaxed ${className}`}
    >
      {children}
    </p>
  );
}

function Accent({ children }: { children: ReactNode }) {
  return <span className="text-accent">{children}</span>;
}

function Quote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="max-w-3xl border-accent/40 border-l-2 pl-6 font-serif text-xl italic text-foreground/80 md:text-2xl">
      {children}
    </blockquote>
  );
}

function PersonCard({ who, why, tone }: { who: string; why: string; tone: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card/40 p-5"
    >
      <p className="font-serif text-2xl tracking-tight">{who}</p>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">{why}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{tone}</p>
    </motion.div>
  );
}

function NotebookCard({ title, items }: { title: string; items: ReadonlyArray<string> }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="rounded-lg border border-border bg-card/40 p-5"
    >
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">{title}</p>
      <ul className="space-y-2 text-sm leading-relaxed text-foreground/85">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-muted-foreground" aria-hidden>
              →
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function WikiPreview({ label, sections }: { label: string; sections: ReadonlyArray<string> }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="rounded-lg border border-border bg-card/40 p-5"
    >
      <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">{label}</p>
      <ul className="space-y-1.5 font-serif text-lg">
        {sections.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-accent/60" aria-hidden />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function PerspectiveLine({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card/40 px-4 py-3 text-foreground/90">
      {children}
    </div>
  );
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: stable index for fixed-length progress markers.
          key={i}
          className={`h-1 rounded-full transition-all duration-300 ${
            i === current ? 'w-8 bg-accent' : 'w-1.5 bg-muted-foreground/30'
          }`}
        />
      ))}
    </div>
  );
}
