import type { Artifact } from '@package/contracts/shared';
import { CitationChip } from '../../citation/citation-chip.tsx';

type ComparisonTableArtifact = Extract<Artifact, { kind: 'ComparisonTable' }>;

export function ComparisonTable({ artifact }: { artifact: ComparisonTableArtifact }) {
  const { props, citations } = artifact;
  const byId = new Map<string, (typeof citations)[number]>(citations.map((c) => [c.id, c]));
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            {props.columns.map((col) => (
              <th
                key={col}
                className="px-3 py-2 text-left font-mono text-xs uppercase tracking-wider"
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
                    <td key={cellKey} className="px-3 py-2">
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
