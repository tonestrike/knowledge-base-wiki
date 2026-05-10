import type { LintFinding } from '@package/contracts/verification';
import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';
import { Button } from '../ui/button.tsx';

const verdictTone: Record<LintFinding['verdict'], string> = {
  supported: 'border-verdict-supported/40 bg-verdict-supported/5',
  unsupported: 'border-verdict-unsupported/40 bg-verdict-unsupported/5',
  contradicted: 'border-verdict-contradicted/40 bg-verdict-contradicted/5',
};

export function LintRibbon({
  finding,
  onApply,
}: {
  finding: LintFinding;
  onApply: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const [applied, setApplied] = useState(false);
  return (
    <motion.aside
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={
        applied
          ? reduce
            ? { opacity: 0 }
            : { opacity: 0, y: -12, height: 0, marginTop: 0, marginBottom: 0 }
          : { opacity: 1, y: 0 }
      }
      transition={{ type: 'spring', stiffness: 200, damping: 25 }}
      className={`overflow-hidden rounded-lg border ${verdictTone[finding.verdict]} px-5 py-4`}
    >
      <p className="font-mono text-[10px] uppercase tracking-widest">Verdict: {finding.verdict}</p>
      <div className="mt-3 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Claim
          </p>
          <p className="mt-1 font-serif text-sm">{finding.claim.claimText}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Cited span
          </p>
          <p className="mt-1 font-serif text-sm">{finding.evidenceText}</p>
        </div>
      </div>
      {finding.correction ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Correction
          </p>
          <p className="mt-1 font-serif text-sm">
            <span className="text-verdict-contradicted line-through">
              {finding.claim.claimText}
            </span>{' '}
            <span className="text-verdict-supported underline decoration-2 underline-offset-2">
              {finding.correction.replacementText}
            </span>
          </p>
          <Button
            onClick={() => {
              setApplied(true);
              onApply(finding.id);
            }}
            variant="accent"
            size="sm"
            className="mt-3"
            disabled={applied}
          >
            {applied ? 'Applied' : 'Apply correction'}
          </Button>
        </div>
      ) : null}
    </motion.aside>
  );
}
