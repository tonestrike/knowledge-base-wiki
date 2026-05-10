import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.tsx';
import { useCitationFlight } from './use-citation-flight.tsx';

const CONTEXT_CHARS = 280;

interface SourceText {
  text: string;
  loading: boolean;
  error: string | null;
}

function useSourceText(sourceId: string | null): SourceText {
  const [state, setState] = useState<SourceText>({ text: '', loading: false, error: null });
  useEffect(() => {
    if (!sourceId) {
      setState({ text: '', loading: false, error: null });
      return;
    }
    const ac = new AbortController();
    setState({ text: '', loading: true, error: null });
    fetch(`/__source/${sourceId}/text`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`source text ${res.status}`);
        return res.text();
      })
      .then((text) => setState({ text, loading: false, error: null }))
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setState({ text: '', loading: false, error: (err as Error).message });
      });
    return () => ac.abort();
  }, [sourceId]);
  return state;
}

export function CitationModal() {
  const { active, close } = useCitationFlight();
  const reduce = useReducedMotion();
  const sourceId = active?.span.sourceId ?? null;
  const { text, loading, error } = useSourceText(sourceId);

  return (
    <Dialog open={!!active} onOpenChange={(o) => !o && close()}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-3xl">
        {active ? (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 240, damping: 26 }}
            className="grid grid-rows-[auto_1fr_auto] bg-background"
          >
            <header className="flex items-center justify-between border-b border-border px-6 py-4">
              <DialogTitle className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {active.label}
              </DialogTitle>
              <span className="font-mono text-[10px] text-muted-foreground">
                bytes {active.span.byteRange.start}–{active.span.byteRange.end}
              </span>
            </header>

            <section className="max-h-[60vh] overflow-y-auto bg-muted/20 px-6 py-5 font-serif leading-relaxed">
              {loading ? (
                <p className="text-sm text-muted-foreground">loading source…</p>
              ) : error ? (
                <p className="text-sm text-destructive">Source preview failed: {error}</p>
              ) : (
                <SourceExcerpt
                  text={text}
                  rangeStart={active.span.byteRange.start}
                  rangeEnd={active.span.byteRange.end}
                />
              )}
            </section>

            <footer className="flex items-center justify-between gap-4 border-t border-border px-6 py-3 font-mono text-[10px] text-muted-foreground">
              <span className="truncate">{active.span.contentHash}</span>
              <a
                href={`/__source/${active.span.sourceId}/raw`}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline-offset-2 hover:underline"
              >
                Open source PDF →
              </a>
            </footer>
          </motion.div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Renders a windowed excerpt of the source text with the cited byte range
 * highlighted. The byte→char approximation is fine here: the source text
 * stored in R2 is the same UTF-8 buffer the spans were measured against
 * during ingestion.
 */
function SourceExcerpt({
  text,
  rangeStart,
  rangeEnd,
}: {
  text: string;
  rangeStart: number;
  rangeEnd: number;
}) {
  if (rangeStart >= text.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Span is outside the extracted text (range {rangeStart}–{rangeEnd}, source length{' '}
        {text.length}).
      </p>
    );
  }
  const start = Math.max(0, rangeStart - CONTEXT_CHARS);
  const end = Math.min(text.length, rangeEnd + CONTEXT_CHARS);
  const before = text.slice(start, rangeStart);
  const inside = text.slice(rangeStart, Math.min(rangeEnd, text.length));
  const after = text.slice(rangeEnd, end);
  return (
    <p className="whitespace-pre-wrap text-base">
      {start > 0 ? <span className="text-muted-foreground">…</span> : null}
      <span className="text-muted-foreground">{before}</span>
      <mark className="rounded-sm bg-accent/30 px-0.5 text-foreground">{inside}</mark>
      <span className="text-muted-foreground">{after}</span>
      {end < text.length ? <span className="text-muted-foreground">…</span> : null}
    </p>
  );
}
