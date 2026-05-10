import { describe, expect, it } from 'bun:test';
import { Outline } from '../domain/outline.ts';
import type { ExtractorRegistry } from './extract-source.ts';
import { extractSource } from './extract-source.ts';

const makeExtractor = (label: string, calls: string[]) => ({
  extract: async ({ bytes }: { bytes: Uint8Array }) => {
    calls.push(`${label}:${bytes.length}`);
    return {
      text: label,
      outline: Outline.empty(),
      pageCount: 1,
      pageImages: [] as ReadonlyArray<{ pageNumber: number; png: Uint8Array }>,
    };
  },
});

const makeRegistry = (calls: string[]): ExtractorRegistry => ({
  pdf: makeExtractor('pdf', calls),
  doc: makeExtractor('doc', calls),
  sheet: makeExtractor('sheet', calls),
  slide: makeExtractor('slide', calls),
});

describe('extractSource', () => {
  it('uses the PDF extractor for application/pdf', async () => {
    const calls: string[] = [];
    const out = await extractSource(makeRegistry(calls), {
      mime: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(calls).toEqual(['pdf:3']);
    expect(out.text).toBe('pdf');
  });

  it('routes Google Doc / Sheet / Slide MIMEs to their extractors', async () => {
    const calls: string[] = [];
    await extractSource(makeRegistry(calls), {
      mime: 'application/vnd.google-apps.document',
      bytes: new Uint8Array(),
    });
    await extractSource(makeRegistry(calls), {
      mime: 'application/vnd.google-apps.spreadsheet',
      bytes: new Uint8Array(),
    });
    await extractSource(makeRegistry(calls), {
      mime: 'application/vnd.google-apps.presentation',
      bytes: new Uint8Array(),
    });
    expect(calls).toEqual(['doc:0', 'sheet:0', 'slide:0']);
  });

  it('routes text/plain and text/markdown through the pdf extractor (text-as-PDF reuse)', async () => {
    const calls: string[] = [];
    await extractSource(makeRegistry(calls), {
      mime: 'text/plain',
      bytes: new Uint8Array([5]),
    });
    await extractSource(makeRegistry(calls), {
      mime: 'text/markdown',
      bytes: new Uint8Array([6, 7]),
    });
    expect(calls).toEqual(['pdf:1', 'pdf:2']);
  });
});
