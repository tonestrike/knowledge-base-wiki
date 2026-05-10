import { motion, useReducedMotion } from 'framer-motion';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.tsx';
import { useCitationFlight } from './use-citation-flight.tsx';

export function CitationModal() {
  const { active, close } = useCitationFlight();
  const reduce = useReducedMotion();
  // Radix Dialog handles mount/unmount; the inner motion.div with layoutId
  // animates both directions of the chip↔modal flight. AnimatePresence here
  // would unmount the modal before the layout animation can target the chip
  // on close, breaking "Reverse on close" (spec §3.4).
  // prefers-reduced-motion falls back to a fade so the citation flight stays
  // legible without vestibular triggers.
  return (
    <Dialog open={!!active} onOpenChange={(o) => !o && close()}>
      <DialogContent className="overflow-hidden p-0">
        {active ? (
          <motion.div
            layoutId={reduce ? undefined : `citation-${active.id}`}
            initial={reduce ? { opacity: 0 } : false}
            animate={reduce ? { opacity: 1 } : undefined}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            className="grid grid-rows-[auto_1fr] bg-background"
          >
            <header className="flex items-center justify-between border-b border-border px-6 py-4">
              <DialogTitle className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {active.label}
              </DialogTitle>
              <span className="font-mono text-[10px] text-muted-foreground">
                bytes {active.span.byteRange.start}–{active.span.byteRange.end}
              </span>
            </header>
            <section className="grid h-[60vh] place-items-center bg-muted/40">
              <div className="text-center">
                <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  Source preview
                </p>
                <p className="mt-2 max-w-prose text-sm text-muted-foreground">
                  PDF.js page render with byte-range overlay lands when 2.A's R2 source proxy is
                  wired. The label, span identity and content hash are the live contract surface.
                </p>
                <p className="mt-4 font-mono text-[10px] text-muted-foreground">
                  {active.span.contentHash}
                </p>
              </div>
            </section>
          </motion.div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
