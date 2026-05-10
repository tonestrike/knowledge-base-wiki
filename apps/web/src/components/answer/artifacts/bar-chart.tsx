import type { Artifact } from '@package/contracts/shared';
import {
  Bar,
  CartesianGrid,
  BarChart as Recharts,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type BarChartArtifact = Extract<Artifact, { kind: 'BarChart' }>;

export function BarChart({ artifact }: { artifact: BarChartArtifact }) {
  const { props } = artifact;
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <Recharts data={props.bars}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="x" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="y" fill="hsl(var(--accent))" />
        </Recharts>
      </ResponsiveContainer>
    </div>
  );
}
