import { z } from 'zod';
import { Citation } from './citation.ts';

export const ArtifactKind = z.enum([
  'ComparisonTable',
  'Timeline',
  'LineChart',
  'BarChart',
  'KeyMetric',
  'CodeBlock',
  'Quote',
  'Markdown',
]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

const Cell = z.object({
  value: z.string(),
  citationId: z.string().uuid().optional(),
});

const ComparisonTableProps = z.object({
  columns: z.array(z.string()).min(2).max(8),
  rows: z
    .array(
      z.object({
        cells: z.array(Cell).min(2).max(8),
      }),
    )
    .max(40),
});

const TimelineProps = z.object({
  events: z
    .array(
      z.object({
        at: z.string(),
        label: z.string(),
        description: z.string().optional(),
        citationId: z.string().uuid().optional(),
      }),
    )
    .max(40),
});

const SeriesPoint = z.object({
  x: z.union([z.string(), z.number()]),
  y: z.number(),
  citationId: z.string().uuid().optional(),
});

const LineChartProps = z.object({
  xLabel: z.string(),
  yLabel: z.string(),
  series: z.array(z.object({ name: z.string(), points: z.array(SeriesPoint).max(60) })).max(6),
});

const BarChartProps = z.object({
  xLabel: z.string(),
  yLabel: z.string(),
  bars: z.array(SeriesPoint).max(40),
});

const KeyMetricProps = z.object({
  label: z.string(),
  value: z.string(),
  delta: z.string().optional(),
  trend: z.enum(['up', 'down', 'flat']).optional(),
  citationId: z.string().uuid().optional(),
});

const CodeBlockProps = z.object({
  language: z.string(),
  source: z.string().max(20_000),
});

const QuoteProps = z.object({
  text: z.string().max(2000),
  attribution: z.string().optional(),
  citationId: z.string().uuid().optional(),
});

const MarkdownProps = z.object({
  body: z.string().max(20_000),
});

export const Artifact = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ComparisonTable'),
    props: ComparisonTableProps,
    citations: z.array(Citation).min(1),
  }),
  z.object({
    kind: z.literal('Timeline'),
    props: TimelineProps,
    citations: z.array(Citation).min(1),
  }),
  z.object({
    kind: z.literal('LineChart'),
    props: LineChartProps,
    citations: z.array(Citation).min(1),
  }),
  z.object({
    kind: z.literal('BarChart'),
    props: BarChartProps,
    citations: z.array(Citation).min(1),
  }),
  z.object({
    kind: z.literal('KeyMetric'),
    props: KeyMetricProps,
    citations: z.array(Citation).min(1),
  }),
  z.object({
    kind: z.literal('CodeBlock'),
    props: CodeBlockProps,
    citations: z.array(Citation).min(1),
  }),
  z.object({
    kind: z.literal('Quote'),
    props: QuoteProps,
    citations: z.array(Citation).min(1),
  }),
  z.object({
    kind: z.literal('Markdown'),
    props: MarkdownProps,
    citations: z.array(Citation).min(1),
  }),
]);
export type Artifact = z.infer<typeof Artifact>;

export const AnswerSegment = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('prose'), text: z.string().min(1) }),
  z.object({ kind: z.literal('citation'), citation: Citation }),
  z.object({ kind: z.literal('artifact'), artifact: Artifact }),
]);
export type AnswerSegment = z.infer<typeof AnswerSegment>;
