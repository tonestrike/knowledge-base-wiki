import type { AnswerEvent } from '@package/contracts/chat';
import { AnimatePresence, motion } from 'framer-motion';

interface LogEntry {
  id: string;
  /** ISO time the event arrived (we approximate with Date.now since the stream
   *  doesn't carry server timestamps).  */
  at: number;
  /** Pre-formatted line, ready to render. */
  text: string;
  /** Subtle tint used on the left rail. */
  tone: 'info' | 'work' | 'output' | 'success' | 'error';
}

interface DerivedLog {
  entries: LogEntry[];
  /** Top-line state shown in the stepper above the log. */
  status: 'queued' | 'researching' | 'synthesizing' | 'finished' | 'failed';
  /** Cumulative segment count. */
  segments: number;
}

const RESEARCH_HINTS = [
  'querying wiki page index',
  'scoring candidate pages by token overlap',
  'reading body + citations from R2',
  'extracting findings into the prompt',
];

export function deriveLog(
  events: ReadonlyArray<AnswerEvent>,
  question: string,
  startedAt: number,
): DerivedLog {
  const entries: LogEntry[] = [];
  let segments = 0;
  let status: DerivedLog['status'] = 'queued';

  // Always lead with the question so the user has context inside the log.
  entries.push({
    id: 'question',
    at: startedAt,
    text: `Question received: "${trim(question, 120)}"`,
    tone: 'info',
  });

  // Synthetic Researcher narration. The chat dispatcher doesn't (yet) emit
  // intermediate "found N candidates" events, so we narrate the step from
  // the wall-clock between AnswerStarted and the first AnswerSegment.
  let lastResearchHintIdx = -1;

  for (const e of events) {
    const at = Date.now(); // server timestamps would be better; this is fine for a live log
    if (e.kind === 'AnswerStarted') {
      entries.push({
        id: 'started',
        at,
        text: 'Researcher started — searching for grounded findings',
        tone: 'work',
      });
      status = 'researching';
    } else if (e.kind === 'AnswerSegment') {
      if (status === 'researching') {
        entries.push({
          id: 'research-done',
          at,
          text: 'Researcher returned findings — handing off to Synthesizer',
          tone: 'success',
        });
        entries.push({
          id: 'synth-start',
          at,
          text: 'Synthesizer composing answer in segments',
          tone: 'work',
        });
        status = 'synthesizing';
      }
      segments++;
      const seg = e.segment;
      if (seg.kind === 'prose') {
        const preview = trim(seg.text.replace(/\s+/g, ' '), 90);
        entries.push({
          id: `seg-${e.index}`,
          at,
          text: `segment ${e.index + 1}: prose · "${preview}"`,
          tone: 'output',
        });
      } else if (seg.kind === 'citation') {
        entries.push({
          id: `seg-${e.index}`,
          at,
          text: `segment ${e.index + 1}: citation · ${seg.citation.label}`,
          tone: 'output',
        });
      } else {
        entries.push({
          id: `seg-${e.index}`,
          at,
          text: `segment ${e.index + 1}: artifact · ${seg.artifact.kind}`,
          tone: 'output',
        });
      }
    } else if (e.kind === 'AnswerProseDelta') {
      // Skip per-token deltas in the high-level log; they'd flood it.
    } else if (e.kind === 'AnswerFailed') {
      entries.push({
        id: 'failed',
        at,
        text: `Failed: ${e.message}`,
        tone: 'error',
      });
      status = 'failed';
    } else if (e.kind === 'AnswerFinished') {
      entries.push({
        id: 'finished',
        at,
        text: `Answer finished — ${segments} segment${segments === 1 ? '' : 's'} streamed`,
        tone: 'success',
      });
      status = 'finished';
    }
  }

  // While Researcher is in flight without sub-events, rotate through hints
  // so the log shows visible progress.
  if (status === 'researching') {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const idx = Math.min(RESEARCH_HINTS.length - 1, Math.floor(elapsedSec / 2));
    if (idx > lastResearchHintIdx && RESEARCH_HINTS[idx]) {
      lastResearchHintIdx = idx;
      entries.push({
        id: `hint-${idx}`,
        at: Date.now(),
        text: RESEARCH_HINTS[idx],
        tone: 'info',
      });
    }
  }

  return { entries, status, segments };
}

const trim = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;

export function AgentLog({
  entries,
  startedAt,
}: {
  entries: ReadonlyArray<LogEntry>;
  startedAt: number;
}) {
  return (
    <ol className="relative ml-3 space-y-2 border-l border-border/60 pl-5">
      <AnimatePresence initial={false}>
        {entries.map((e) => (
          <motion.li
            key={e.id}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
            className="relative"
          >
            <span
              className={`absolute -left-[26px] top-1.5 h-2 w-2 rounded-full ${
                e.tone === 'work'
                  ? 'bg-accent'
                  : e.tone === 'success'
                    ? 'bg-emerald-400'
                    : e.tone === 'error'
                      ? 'bg-rose-400'
                      : e.tone === 'output'
                        ? 'bg-sky-400'
                        : 'bg-muted-foreground/60'
              }`}
            />
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-mono text-[11px] text-muted-foreground">
                <span className="text-foreground/90">{e.text}</span>
              </p>
              <p className="shrink-0 font-mono text-[10px] text-muted-foreground/70 tabular-nums">
                +{((e.at - startedAt) / 1000).toFixed(1)}s
              </p>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
