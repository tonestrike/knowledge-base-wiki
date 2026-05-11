import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMarkdownExtractor } from './markdown-extractor.ts';

const fixturePath = (name: string) => join(import.meta.dir, '__fixtures__', name);

describe('createMarkdownExtractor', () => {
  it('decodes UTF-8 bytes verbatim and reports a single page', async () => {
    const bytes = new TextEncoder().encode('# hi\n\nbody.');
    const out = await createMarkdownExtractor().extract({ bytes });
    expect(out.text).toBe('# hi\n\nbody.');
    expect(out.pageCount).toBe(1);
    expect(out.outline.nodes).toEqual([]);
    expect(out.pageImages).toEqual([]);
  });

  it('preserves headings and list structure (no header parsing)', async () => {
    const bytes = new Uint8Array(readFileSync(fixturePath('hello.md')));
    const out = await createMarkdownExtractor().extract({ bytes });
    expect(out.text).toContain('# Hello');
    expect(out.text).toContain('- one');
    expect(out.text).toContain('**markdown**');
    expect(out.pageCount).toBe(1);
    expect(out.outline.nodes).toEqual([]);
  });
});
