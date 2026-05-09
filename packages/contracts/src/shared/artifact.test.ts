import { describe, expect, it } from 'bun:test';
import { AnswerSegment, Artifact, ArtifactKind } from './artifact.ts';
import { citationId, sourceId } from './ids.ts';

describe('Artifact', () => {
  const sampleCitation = {
    id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
    label: 'src',
    span: {
      sourceId: sourceId('11111111-2222-4333-8444-555555555555'),
      byteRange: { start: 0, end: 1 },
      contentHash: 'sha256:abc',
    },
  };

  it('lists exactly the eight closed kinds', () => {
    expect(ArtifactKind.options).toEqual([
      'ComparisonTable',
      'Timeline',
      'LineChart',
      'BarChart',
      'KeyMetric',
      'CodeBlock',
      'Quote',
      'Markdown',
    ]);
  });

  it('parses a ComparisonTable artifact with citations on cells', () => {
    const a = Artifact.parse({
      kind: 'ComparisonTable',
      props: {
        columns: ['Quarter', 'Target', 'Actual'],
        rows: [
          {
            cells: [
              { value: 'Q3' },
              { value: '108' },
              { value: '110', citationId: sampleCitation.id },
            ],
          },
        ],
      },
      citations: [sampleCitation],
    });
    expect(a.kind).toBe('ComparisonTable');
  });

  it('rejects unknown artifact kinds at parse time', () => {
    expect(() => Artifact.parse({ kind: 'Pie', props: {}, citations: [sampleCitation] })).toThrow();
  });

  it('AnswerSegment is a discriminated union with three branches', () => {
    const prose = AnswerSegment.parse({ kind: 'prose', text: 'Hello' });
    expect(prose.kind).toBe('prose');

    const cite = AnswerSegment.parse({ kind: 'citation', citation: sampleCitation });
    expect(cite.kind).toBe('citation');

    const art = AnswerSegment.parse({
      kind: 'artifact',
      artifact: {
        kind: 'KeyMetric',
        props: { label: 'NRR', value: '110%' },
        citations: [sampleCitation],
      },
    });
    expect(art.kind).toBe('artifact');
  });
});
