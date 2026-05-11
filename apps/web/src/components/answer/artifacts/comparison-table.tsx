import type { Artifact } from '@package/contracts/shared';
import { CitationChip } from '../../citation/citation-chip.tsx';

type ComparisonTableArtifact = Extract<Artifact, { kind: 'ComparisonTable' }>;

export function ComparisonTable({ artifact }: { artifact: ComparisonTableArtifact }) {
  const { props, citations } = artifact;
  const byId = new Map<string, (typeof citations)[number]>(citations.map((c) => [c.id, c]));
  return (
    // Horizontal scroll for wide tables — the chat dock is narrow and a
    // 3+ column ComparisonTable would otherwise clip the rightmost column
    // off-screen. `overflow-x-auto` shows a scrollbar only when needed;
    // `min-w-max` lets the table size to its content (rather than
    // squeezing into the dock width) so each column is readable.
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-max text-sm">
        <thead className="bg-muted">
          <tr>
            {props.columns.map((col) => (
              <th
                key={col}
                className="whitespace-nowrap px-3 py-2 text-left font-mono text-xs uppercase tracking-wider"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => {
            const rowKey = `r${i}-${row.cells[0]?.value ?? ''}`;
            return (
              <tr key={rowKey} className="border-t border-border">
                {row.cells.map((cell, j) => {
                  const c = cell.citationId ? byId.get(cell.citationId) : undefined;
                  const cellKey = `${rowKey}-c${j}-${cell.value}`;
                  return (
                    <td key={cellKey} className="max-w-xs px-3 py-2 align-top">
                      <span>{cell.value}</span>
                      {c ? (
                        <span className="ml-2">
                          <CitationChip citation={c} />
                        </span>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
