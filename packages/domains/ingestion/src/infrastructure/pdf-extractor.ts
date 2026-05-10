// PDF extraction using `unpdf`, a community fork of pdfjs purpose-built
// for serverless / edge runtimes. Why not stock `pdfjs-dist`?
//
//   - pdfjs's `PDFWorker._setupFakeWorkerGlobal` does a runtime
//     `import(workerSrc)` to load `pdf.worker.mjs`. workerd resolves
//     modules at bundle time so the dynamic import fails with
//     "No such module 'pdf.worker.mjs'".
//   - We tried `import * as w from 'pdfjs-dist/.../pdf.worker.mjs'` +
//     `globalThis.pdfjsWorker = w` to short-circuit the import — that
//     bundles a ~2 MB worker module whose top-level side effects wedge
//     the workerd isolate (it boots, binds the port, but never responds).
//
// `unpdf` ships pdfjs with the worker bundle inlined and the missing
// edge-runtime polyfills stitched in (FinalizationRegistry, etc.). It
// loads cleanly in workerd, has zero native deps, and exposes
// `extractTextItems` which gives us per-page text-item structure to
// build our outline against.
//
// Note: `unpdf` is imported lazily inside `extract()`, NOT at the top
// of the module. Importing it at module scope wedges workerd's isolate
// boot — bound port, no responses — because the inlined worker bundle's
// top-level side effects (postMessage handlers, FinalizationRegistry
// setup) take ~seconds and block whatever signal workerd needs to mark
// the Worker "ready". A dynamic import inside the function defers the
// load until the first PDF arrives; from then on it's hot in the
// isolate and subsequent extract() calls are fast.
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
    // Lazy import — see module-top comment.
    const { extractTextItems, getDocumentProxy } = await import('unpdf');
    // `extractTextItems` returns text grouped by page, preserving the
    // structural information pdfjs's `getTextContent()` would have given
    // us — we use it to keep the heading-outline behavior the previous
    // implementation produced.
    const data = new Uint8Array(bytes.byteLength);
    data.set(bytes);
    const doc = await getDocumentProxy(data);
    const { totalPages, items: pages } = await extractTextItems(doc);

    const nodes: OutlineNode[] = [];
    let cursor = 0;
    let full = '';

    for (let p = 0; p < pages.length; p++) {
      const pageItems = pages[p];
      if (!pageItems) continue;
      const oneIndexedPage = p + 1;
      for (const item of pageItems) {
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
            page: oneIndexedPage,
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
      pageCount: totalPages,
      // Server-side page-image rendering needs node-canvas + a worker; we
      // defer that to the web client (Phase 2.E uses pdfjs in-browser).
      pageImages: [],
    };
  },
});
