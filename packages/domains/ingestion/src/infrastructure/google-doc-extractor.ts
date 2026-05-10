import type { Extractor } from '../application/extract-source.ts';
import { Outline } from '../domain/outline.ts';

// The Drive connector exports Google Docs as text/plain, so the bytes IS the
// text. No outline inference in v1 — Markdown headings would let us; plain
// text doesn't.
export const createGoogleDocExtractor = (): Extractor => ({
  async extract({ bytes }) {
    const text = new TextDecoder().decode(bytes);
    return { text, outline: Outline.empty(), pageCount: 1, pageImages: [] };
  },
});
