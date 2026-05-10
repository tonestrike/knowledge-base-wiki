import { describe, expect, it } from 'bun:test';
import { sourceId } from './ids.ts';
import { ByteRange, ContentHash, Span, spanIdentity } from './span.ts';

describe('Span', () => {
  const sid = sourceId('11111111-2222-4333-8444-555555555555');

  it('parses a well-formed span', () => {
    const span = Span.parse({
      sourceId: sid,
      byteRange: { start: 0, end: 100 },
      contentHash: 'sha256:abc123',
    });
    expect(span.contentHash as string).toBe('sha256:abc123');
  });

  it('rejects byteRange where end <= start', () => {
    expect(() =>
      Span.parse({
        sourceId: sid,
        byteRange: { start: 100, end: 100 },
        contentHash: 'sha256:abc',
      }),
    ).toThrow(/byte range must have positive length/);
  });

  it('rejects content hashes without a prefix', () => {
    expect(() => ContentHash.parse('abc123')).toThrow();
  });

  it('produces a stable identity string', () => {
    const span = Span.parse({
      sourceId: sid,
      byteRange: { start: 0, end: 10 },
      contentHash: 'sha256:abc',
    });
    expect(spanIdentity(span)).toBe(`${sid}:0-10:sha256:abc`);
  });

  it('byteRange rejects negative starts', () => {
    expect(() => ByteRange.parse({ start: -1, end: 1 })).toThrow();
  });
});
