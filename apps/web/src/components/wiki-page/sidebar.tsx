import type { WikiPage } from '@package/contracts/wiki';
import { CitationChip } from '../citation/citation-chip.tsx';

export function Sidebar({ page }: { page: WikiPage }) {
  return (
    <aside className="space-y-8 border-l border-border pl-6 text-sm">
      <section>
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Citations
        </h2>
        <ul className="mt-3 space-y-2">
          {page.citations.map((c) => (
            <li key={c.id}>
              <CitationChip citation={c} />
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Last verified
        </h2>
        <p className="mt-2 text-muted-foreground">{new Date(page.updatedAt).toLocaleString()}</p>
      </section>
    </aside>
  );
}
