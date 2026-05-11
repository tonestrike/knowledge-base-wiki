import type { Extractor } from '../application/extract-source.ts';
import { Outline } from '../domain/outline.ts';

// Plain Markdown (and text/plain) — raw bytes decoded as UTF-8. We don't parse
// headings or render HTML here: the wiki Drafter receives the raw markdown and
// treats it as prose (the heading structure is preserved verbatim in the
// extracted text, which is what citations span over). One "page" because
// markdown has no native page break.
export const createMarkdownExtractor = (): Extractor => ({
  async extract({ bytes }) {
    const text = new TextDecoder().decode(bytes);
    return { text, outline: Outline.empty(), pageCount: 1, pageImages: [] };
  },
});
