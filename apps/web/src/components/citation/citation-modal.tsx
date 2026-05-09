import { AnimatePresence, motion } from 'framer-motion';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog.tsx';
import { useCitationFlight } from './use-citation-flight.tsx';

export function CitationModal() {
  const { active, close } = useCitationFlight();
  return (
    <Dialog open={!!active} onOpenChange={(o) => !o && close()}>
      <DialogContent className="overflow-hidden p-0">
        <AnimatePresence>
          {active ? (
            <motion.div
              layoutId={`citation-${active.id}`}
              className="grid grid-rows-[auto_1fr] bg-background"
            >
              <header className="flex items-center justify-between border-b border-border px-6 py-4">
                <DialogTitle className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  {active.label}
                </DialogTitle>
                <span className="font-mono text-[10px] text-muted-foreground">
                  bytes {active.span.byteRange.start}-{active.span.byteRange.end}
                </span>
              </header>
              <section className="grid h-[60vh] place-items-center bg-muted">
                <p className="text-muted-foreground">PDF.js preview lands in 2.A</p>
              </section>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
