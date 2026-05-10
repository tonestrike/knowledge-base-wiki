import { AnimatePresence, motion } from 'framer-motion';
import type { TimedAnswerEvent } from './use-answer-stream.ts';

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

export function deriveLog(
  events: ReadonlyArray<TimedAnswerEvent>,
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

  for (const timed of events) {
    const e = timed.event;
    const at = timed.arrivedAt;
    if (e.kind === 'AnswerStarted') {
      entries.push({
        id: 'started',
        at,
        text: 'Turn dispatched — orchestrating Researcher and Synthesizer',
        tone: 'info',
      });
      status = 'researching';
    } else if (e.kind === 'ResearchStarted') {
      entries.push({
        id: 'research-start',
        at,
        text: `Researcher started (${e.model})`,
        tone: 'work',
      });
      status = 'researching';
    } else if (e.kind === 'ResearchProgress') {
      entries.push({
        id: `research-progress-${e.findingsExtracted}`,
        at,
        text: `Researcher · ${e.findingsExtracted} finding${
          e.findingsExtracted === 1 ? '' : 's'
        } extracted so far`,
        tone: 'output',
      });
    } else if (e.kind === 'ResearchCompleted') {
      entries.push({
        id: 'research-done',
        at,
        text: `Researcher returned · ${e.candidatePageCount} candidate page${
          e.candidatePageCount === 1 ? '' : 's'
        } scored, ${e.findingCount} finding${e.findingCount === 1 ? '' : 's'} extracted`,
        tone: 'success',
      });
    } else if (e.kind === 'SynthesisStarted') {
      entries.push({
        id: 'synth-start',
        at,
        text: `Synthesizer started (${e.model}) — composing answer in segments`,
        tone: 'work',
      });
      status = 'synthesizing';
    } else if (e.kind === 'AnswerSegment') {
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
        text: `Answer finished · ${segments} segment${segments === 1 ? '' : 's'} streamed`,
        tone: 'success',
      });
      status = 'finished';
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
