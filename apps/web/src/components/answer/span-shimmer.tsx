import { type CitationId, citationId } from '@package/contracts/shared';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * One textual run inside a prose segment, modelled as a discriminated
 * union (TD1). The shimmer renders three kinds:
 *   - 'plain'    → no shimmer, plain text.
 *   - 'cited'    → wavy underline + shimmer; anchored to a CitationId.
 *   - 'broken'   → plain text + a small "?" indicator (SF11). Used when
 *                  the marker parser couldn't recover a usable citation —
 *                  the user still sees the prose, but we don't pretend a
 *                  bad id resolves to a real source.
 *
 * Per spec §4.3 #6, the shimmer's job is to make every cited word a
 * direct hyperlink to provenance — wrapping the whole paragraph would
 * dilute that signal.
 *
 * TODO(2.B/2.E coordination): the `[[cite:<uuid>]]…[[/cite]]` marker
 * convention coordinates with 2.B's Drafter output. The current chat
 * mock emits plain prose, so the regex tokenizer falls through
 * gracefully. When 2.B's Drafter lands, it must either emit these
 * markers or the contract grows a structured `SpanRun[]` shape on
 * `AnswerSegment.kind === 'prose'`. Tracked at:
 * https://github.com/tonestrike/tenex/issues — see "Coordinate Drafter
 * cite-marker convention with 2.E tokenizeProse".
 */
export type SpanRun =
  | { kind: 'plain'; text: string }
  | { kind: 'cited'; text: string; citationId: CitationId }
  | { kind: 'broken'; text: string; reason: string };

export function SpanShimmer({ runs }: { runs: SpanRun[] }) {
  const reduce = useReducedMotion();
  // tokenizeProse emits runs in a stable order with deterministic content;
  // use the offset-derived content key so React can diff incrementally
  // when streaming prose grows.
  const keyed = withStableKeys(runs);
  return (
    <p className="prose-magazine text-lg">
      {keyed.map(({ run, key }) => {
        if (run.kind === 'cited') {
          return (
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
          );
        }
        if (run.kind === 'broken') {
          // Render as plain text with a "?" affordance after the run.
          // The wrapping span carries the title (tooltip on hover) and a
          // role="note" so assistive tech announces the citation issue
          // alongside the prose.
          return (
            <span
              key={key}
              role="note"
              aria-label={`Citation issue: ${run.reason}`}
              title={`Citation issue: ${run.reason}`}
              className="underline decoration-verdict-contradicted decoration-dotted underline-offset-2"
            >
              {run.text}
              <span className="ml-0.5 align-super text-xs text-verdict-contradicted">?</span>
            </span>
          );
        }
        return <span key={key}>{run.text}</span>;
      })}
    </p>
  );
}

function withStableKeys(runs: SpanRun[]): { run: SpanRun; key: string }[] {
  let offset = 0;
  return runs.map((run) => {
    const key = `${offset}:${run.kind}:${run.text.length}`;
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
 * Failure modes (SF11) — instead of silently dropping bad markers, we
 * emit a `broken` run with the literal text plus a console.warn so a
 * future regression in the Drafter shows up in dev logs:
 *   - id fails CitationId.parse (not a UUID)         → broken
 *   - empty inner text between markers                → broken
 *   - unterminated `[[cite:…]]` with no matching close → broken
 *   - nested `[[cite:…]]` inside another (regex is non-greedy, so
 *     the outer pair becomes broken-with-leftover)    → broken
 *
 * If no markers are present (current 1.C mock fixtures), the entire
 * prose segment is returned as a single plain run.
 */
export function tokenizeProse(text: string): SpanRun[] {
  const runs: SpanRun[] = [];
  // Capture the open marker even if the close is missing, so we can
  // distinguish "no markers" from "broken markers".
  const re = /\[\[cite:([^\]]+)\]\](?:([\s\S]*?)\[\[\/cite\]\])?/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = re.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      runs.push({ kind: 'plain', text: text.slice(lastIndex, match.index) });
    }
    const rawId = match[1];
    const inner = match[2];
    const literal = match[0];
    if (inner === undefined) {
      // Unterminated `[[cite:…]]` — no closing tag in the source.
      console.warn('tokenizeProse: unterminated cite marker', { rawId });
      runs.push({ kind: 'broken', text: literal, reason: 'unterminated cite marker' });
    } else if (inner.length === 0) {
      console.warn('tokenizeProse: empty cite marker', { rawId });
      runs.push({ kind: 'broken', text: '', reason: 'empty cite marker' });
    } else {
      let parsedId: CitationId | null = null;
      if (rawId !== undefined) {
        try {
          parsedId = citationId(rawId);
        } catch {
          parsedId = null;
        }
      }
      if (parsedId === null) {
        console.warn('tokenizeProse: malformed citation id', { rawId, inner });
        runs.push({ kind: 'broken', text: inner, reason: `invalid citation id: ${rawId ?? '∅'}` });
      } else {
        runs.push({ kind: 'cited', text: inner, citationId: parsedId });
      }
    }
    lastIndex = re.lastIndex;
    match = re.exec(text);
  }
  if (lastIndex < text.length) runs.push({ kind: 'plain', text: text.slice(lastIndex) });
  if (runs.length === 0) runs.push({ kind: 'plain', text });
  return runs;
}
