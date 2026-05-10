import { motion, useReducedMotion } from 'framer-motion';

/**
 * One textual run inside a prose segment. A run is either plain text
 * (no shimmer) or anchored to a Span (the wavy underline + shimmer
 * sweep on hover). The Drafter (slice 2.B / 2.C) emits prose tokens
 * with optional `spanId` and `citationId` annotations; the parser
 * below collapses unmarked runs into plain text and only shimmers
 * the runs that carry a citation handle.
 *
 * Per spec §4.3 #6, the shimmer's job is to make every cited word a
 * direct hyperlink to provenance — wrapping the whole paragraph would
 * dilute that signal.
 */
export interface SpanRun {
  text: string;
  citationId?: string;
}

export function SpanShimmer({ runs }: { runs: SpanRun[] }) {
  const reduce = useReducedMotion();
  // tokenizeProse emits runs in a stable order with deterministic content;
  // use the offset-derived content key so React can diff incrementally
  // when streaming prose grows.
  const keyed = withStableKeys(runs);
  return (
    <p className="prose-magazine text-lg">
      {keyed.map(({ run, key }) =>
        run.citationId ? (
          <motion.span
            key={key}
            className="span-shimmer cursor-help"
            data-citation-id={run.citationId}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 1 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {run.text}
          </motion.span>
        ) : (
          <span key={key}>{run.text}</span>
        ),
      )}
    </p>
  );
}

function withStableKeys(runs: SpanRun[]): { run: SpanRun; key: string }[] {
  let offset = 0;
  return runs.map((run) => {
    const key = `${offset}:${run.citationId ?? 'plain'}:${run.text.length}`;
    offset += run.text.length;
    return { run, key };
  });
}

/**
 * Tokenize prose text into Span-anchored runs.
 *
 * Marker convention (forward-compatible with the Drafter's output):
 * `[[cite:<citationId>]]…[[/cite]]` wraps a cited run. Anything outside
 * is plain. We tokenize on the markers so a single prose segment can
 * mix cited and uncited spans without breaking the React tree.
 *
 * If no markers are present (current 1.C mock fixtures), the entire
 * prose segment is returned as a single plain run — the shimmer
 * silences itself instead of bleeding across the whole paragraph.
 */
export function tokenizeProse(text: string): SpanRun[] {
  const runs: SpanRun[] = [];
  const re = /\[\[cite:([0-9a-f-]+)\]\]([\s\S]*?)\[\[\/cite\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = re.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) runs.push({ text: text.slice(lastIndex, match.index) });
    const id = match[1];
    const inner = match[2];
    if (id !== undefined && inner !== undefined && inner.length > 0) {
      runs.push({ text: inner, citationId: id });
    }
    lastIndex = re.lastIndex;
    match = re.exec(text);
  }
  if (lastIndex < text.length) runs.push({ text: text.slice(lastIndex) });
  if (runs.length === 0) runs.push({ text });
  return runs;
}
