// pdfjs-dist 4.10's legacy build is the portable Node-friendly entry. It avoids
// browser-only APIs (DOMMatrix, OffscreenCanvas) that the standard build needs.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Extractor } from '../application/extract-source.ts';
import type { OutlineNode } from '../domain/outline.ts';
import { Outline, outlineLevel } from '../domain/outline.ts';

const isHeading = (raw: string): boolean => {
  const t = raw.trim();
  if (!t || t.length > 80) return false;
  // crude heading heuristic: short lines that start with a capital letter and
  // contain at least one uppercase character (so all-lowercase prose lines
  // don't get tagged). Title-case "Q3 board" passes; "the meeting was" fails.
  return /^[A-Z]/.test(t) && t !== t.toLowerCase();
};

export const createPdfExtractor = (): Extractor => ({
  async extract({ bytes }) {
    // pdfjs mutates the input buffer; pass a copy so callers can keep theirs.
    const data = new Uint8Array(bytes.byteLength);
    data.set(bytes);
    const doc = await getDocument({ data, isEvalSupported: false }).promise;
    const pageCount = doc.numPages;
    const nodes: OutlineNode[] = [];
    let cursor = 0;
    let full = '';

    for (let p = 1; p <= pageCount; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const t = item.str;
        if (!t) continue;
        const start = cursor;
        const end = start + t.length;
        if (isHeading(t)) {
          nodes.push({
            kind: 'heading',
            level: outlineLevel(2),
            title: t.trim(),
            byteRange: { start, end },
            page: p,
          });
        }
        full += `${t} `;
        cursor = end + 1;
      }
      full += '\n';
      cursor += 1;
    }

    return {
      text: full,
      outline: Outline.fromNodes(nodes),
      pageCount,
      // Server-side page-image rendering needs node-canvas + a worker; we
      // defer that to the web client (Phase 2.E uses pdfjs in-browser).
      pageImages: [],
    };
  },
});
