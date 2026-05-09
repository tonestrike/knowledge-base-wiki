import type { ReactNode } from 'react';

export function AgentLane({ name, children }: { name: string; children?: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4">
      <p className="font-mono text-xs uppercase tracking-widest text-accent">{name}</p>
      <div className="min-h-[60px] space-y-2">{children}</div>
    </div>
  );
}
