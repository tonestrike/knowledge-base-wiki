import type { Artifact } from '@package/contracts/shared';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart as Recharts,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type LineChartArtifact = Extract<Artifact, { kind: 'LineChart' }>;

export function LineChart({ artifact }: { artifact: LineChartArtifact }) {
  const { props } = artifact;
  const data: Record<string, number | string>[] = [];
  for (const series of props.series) {
    for (const point of series.points) {
      let row = data.find((r) => r.x === point.x);
      if (!row) {
        row = { x: point.x };
        data.push(row);
      }
      row[series.name] = point.y;
    }
  }
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <Recharts data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" />
          <YAxis />
          <Tooltip />
          <Legend />
          {props.series.map((s) => (
            <Line key={s.name} dataKey={s.name} stroke="hsl(var(--accent))" strokeWidth={2} />
          ))}
        </Recharts>
      </ResponsiveContainer>
    </div>
  );
}
