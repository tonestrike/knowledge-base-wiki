import { describe, expect, it } from 'bun:test';
import { Outline, outlineDepth, outlineLevel } from './outline.ts';

describe('Outline', () => {
  it('captures nested headings and reports the deepest level', () => {
    const o = Outline.fromNodes([
      {
        kind: 'heading',
        level: outlineLevel(1),
        title: 'Q3 board',
        byteRange: { start: 0, end: 30 },
        page: 1,
      },
      {
        kind: 'heading',
        level: outlineLevel(2),
        title: 'Decisions',
        byteRange: { start: 30, end: 60 },
        page: 1,
      },
      {
        kind: 'heading',
        level: outlineLevel(2),
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

  it('outlineLevel rejects 0, negative, and non-integer levels', () => {
    expect(() => outlineLevel(0)).toThrow();
    expect(() => outlineLevel(-1)).toThrow();
    expect(() => outlineLevel(1.5)).toThrow();
    expect(outlineLevel(1)).toBe(1 as ReturnType<typeof outlineLevel>);
  });
});
