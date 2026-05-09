import { describe, expect, it } from 'bun:test';
import { Citation } from './citation.ts';
import { citationId, sourceId } from './ids.ts';

describe('Citation', () => {
  it('wraps a Span with an id and label', () => {
    const c = Citation.parse({
      id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
      label: 'Q3 board minutes, p.4',
      span: {
        sourceId: sourceId('11111111-2222-4333-8444-555555555555'),
        byteRange: { start: 100, end: 250 },
        contentHash: 'sha256:abc',
      },
    });
    expect(c.label).toBe('Q3 board minutes, p.4');
    expect(c.span.byteRange.end).toBe(250);
  });

  it('rejects empty labels', () => {
    expect(() =>
      Citation.parse({
        id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
        label: '',
        span: {
          sourceId: sourceId('11111111-2222-4333-8444-555555555555'),
          byteRange: { start: 0, end: 1 },
          contentHash: 'sha256:abc',
        },
      }),
    ).toThrow();
  });
});
