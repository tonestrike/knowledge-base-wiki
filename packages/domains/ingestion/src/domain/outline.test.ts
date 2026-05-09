import { describe, expect, it } from 'bun:test';
import { Outline, outlineDepth } from './outline.ts';

describe('Outline', () => {
  it('captures nested headings and reports the deepest level', () => {
    const o = Outline.fromNodes([
      {
        kind: 'heading',
        level: 1,
        title: 'Q3 board',
        byteRange: { start: 0, end: 30 },
        page: 1,
      },
      {
        kind: 'heading',
        level: 2,
        title: 'Decisions',
        byteRange: { start: 30, end: 60 },
        page: 1,
      },
      {
        kind: 'heading',
        level: 2,
        title: 'Metrics',
        byteRange: { start: 60, end: 90 },
        page: 2,
      },
    ]);
    expect(o.nodes).toHaveLength(3);
    expect(outlineDepth(o)).toBe(2);
  });

  it('empty() returns no nodes and depth 0', () => {
    const o = Outline.empty();
    expect(o.nodes).toHaveLength(0);
    expect(outlineDepth(o)).toBe(0);
  });
});
