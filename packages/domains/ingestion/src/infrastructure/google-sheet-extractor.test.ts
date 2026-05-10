import { describe, expect, it } from 'bun:test';
import { createGoogleSheetExtractor } from './google-sheet-extractor.ts';

const enc = (s: string) => new TextEncoder().encode(s);

describe('createGoogleSheetExtractor — SF8 CSV parsing', () => {
  it('handles plain rows', async () => {
    const out = await createGoogleSheetExtractor().extract({
      bytes: enc('name,quarter\nQ3 NRR,Q3\n'),
    });
    expect(out.text).toBe('name: Q3 NRR, quarter: Q3');
  });

  it('respects quoted fields with embedded commas', async () => {
    const out = await createGoogleSheetExtractor().extract({
      bytes: enc('summary,quarter\n"Approved EMEA expansion, $2M cap",Q3\n'),
    });
    expect(out.text).toBe('summary: Approved EMEA expansion, $2M cap, quarter: Q3');
  });

  it('respects escaped double-quotes inside a quoted field', async () => {
    const out = await createGoogleSheetExtractor().extract({
      bytes: enc('label,note\n"Q3 ""special""","ok"\n'),
    });
    expect(out.text).toBe('label: Q3 "special", note: ok');
  });

  it('handles CRLF line endings', async () => {
    const out = await createGoogleSheetExtractor().extract({
      bytes: enc('a,b\r\n1,2\r\n3,4\r\n'),
    });
    expect(out.text).toBe('a: 1, b: 2\na: 3, b: 4');
  });
});
