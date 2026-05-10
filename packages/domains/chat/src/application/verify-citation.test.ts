import { describe, expect, it } from 'bun:test';
import { citationId, sourceId } from '@package/contracts/shared';
import type { Citation } from '@package/contracts/shared';
import { createMemorySourceHashVerifier } from './verify-citation.ts';

const sliceHash = async (s: string): Promise<string> =>
  `sha256:${Array.from(s)
    .map((c) => c.charCodeAt(0).toString(16))
    .join('')}`;

const cit = (start: number, end: number, contentHash: string): Citation => ({
  id: citationId('aaaaaaaa-1111-4222-8333-444444444444'),
  label: 'fixture',
  span: {
    sourceId: sourceId('11111111-2222-4333-8444-000000000001'),
    byteRange: { start, end },
    contentHash,
  },
});

describe('createMemorySourceHashVerifier', () => {
  it('passes when the slice hash matches', async () => {
    const verifier = createMemorySourceHashVerifier({
      readSourceText: async () => 'hello world',
      sha256Hex: sliceHash,
    });
    const out = await verifier.verify(cit(0, 5, 'sha256:68656c6c6f'));
    expect(out.ok).toBe(true);
  });

  it('fails when the slice hash mismatches', async () => {
    const verifier = createMemorySourceHashVerifier({
      readSourceText: async () => 'hello world',
      sha256Hex: sliceHash,
    });
    const out = await verifier.verify(cit(0, 5, 'sha256:wrong'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/hash mismatch/);
  });

  it('fails when the byte range overruns the source', async () => {
    const verifier = createMemorySourceHashVerifier({
      readSourceText: async () => 'short',
      sha256Hex: sliceHash,
    });
    const out = await verifier.verify(cit(0, 999, 'sha256:abc'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/overruns/);
  });

  it('fails when the source text is missing', async () => {
    const verifier = createMemorySourceHashVerifier({
      readSourceText: async () => null,
      sha256Hex: sliceHash,
    });
    const out = await verifier.verify(cit(0, 5, 'sha256:abc'));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/not found/);
  });
});
