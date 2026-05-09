import { describe, expect, it } from 'bun:test';
import { SourceId, type WikiId, sourceId } from './ids.ts';

describe('branded IDs', () => {
  it('parses well-formed UUIDs', () => {
    const raw = '11111111-2222-4333-8444-555555555555';
    const parsed = SourceId.parse(raw);
    expect(parsed as string).toBe(raw);
  });

  it('rejects non-UUID strings', () => {
    expect(() => SourceId.parse('not-a-uuid')).toThrow();
  });

  it('rejects cross-brand assignment at compile time via brand tag', () => {
    const id = sourceId('11111111-2222-4333-8444-555555555555');
    // @ts-expect-error WikiId !== SourceId
    const _w: ReturnType<typeof WikiId.parse> = id;
    void _w;
  });
});
