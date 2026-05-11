import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDocxExtractor } from './docx-extractor.ts';

const fixturePath = (name: string) => join(import.meta.dir, '__fixtures__', name);

describe('createDocxExtractor', () => {
  it('extracts plain text from a tiny DOCX fixture (single page, no outline)', async () => {
    const bytes = new Uint8Array(readFileSync(fixturePath('hello.docx')));
    const out = await createDocxExtractor().extract({ bytes });
    expect(out.text).toContain('Hello DOCX world.');
    expect(out.text).toContain('Second paragraph with details.');
    expect(out.pageCount).toBe(1);
    expect(out.outline.nodes).toEqual([]);
    expect(out.pageImages).toEqual([]);
  });
});
