// DOCX extraction via `mammoth`. Mammoth ships an `extractRawText` entry that
// unzips the .docx, walks the OOXML, and returns the document's text content
// in reading order. We use that instead of `convertToHtml` because the wiki
// Drafter treats sources as prose and never sees the rendered HTML.
//
// DOCX has no inherent "page" concept in OOXML — page breaks are render-time
// decisions made by Word's layout engine, not stored in the file. So we expose
// the whole document as one page, byte-range `[0, text.length)`, and let
// citations be byte-anchored instead of page-anchored. (The PDF extractor is
// the only paginated path; Slides has slides; everything else is one-page.)
//
// Lazy `import('mammoth')` keeps the workerd isolate boot fast: mammoth pulls
// in JSZip + xmldom at top-level, which adds tens of ms of parse cost we don't
// want to pay on every Worker cold-start when the request might be a Drive
// listing or a wiki fetch with no DOCX involved.
import type { Extractor } from '../application/extract-source.ts';
import { Outline } from '../domain/outline.ts';

export const createDocxExtractor = (): Extractor => ({
  async extract({ bytes }) {
    const mammoth = await import('mammoth');
    // Mammoth's `buffer` input is forwarded straight to JSZip.loadAsync, which
    // accepts Uint8Array / ArrayBuffer / Buffer. We pass a fresh Uint8Array
    // wrapped over the bytes' ArrayBuffer so the caller's view isn't mutated.
    const data = new Uint8Array(bytes.byteLength);
    data.set(bytes);
    // The mammoth typings declare `buffer: Buffer` (Node), but the underlying
    // implementation accepts Uint8Array at runtime — cast through `unknown` to
    // keep TS happy without pulling in @types/node.
    const result = await mammoth.extractRawText({
      buffer: data as unknown as Buffer,
    });
    const text = result.value;
    return { text, outline: Outline.empty(), pageCount: 1, pageImages: [] };
  },
});
