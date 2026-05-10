// cspell:words pdfs
// Seed local D1 + R2 with the Berkshire fixture PDFs by POSTing to the
// dev-only /__seed/fixtures endpoint on the running api. This bypasses
// Drive entirely so the demo can run without OAuth.
//
// Usage:
//   bun scripts/seed/seed-fixtures.ts [--api=https://api.tenex.localhost:1355]

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const REPO_ROOT = resolve(import.meta.dirname, '../..');
const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';

const argVal = (name: string, fallback: string): string => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.replace(`--${name}=`, '') : fallback;
};

const FIXTURES_DIR = resolve(REPO_ROOT, argVal('dir', '.demo-fixtures'));
const DEMO_FOLDER_ID = argVal('folder-id', '11111111-1111-4111-8111-111111111111');
const DEMO_DRIVE_FOLDER_ID = argVal('drive-folder-id', 'demo-folder-fixtures');
const DEMO_FOLDER_NAME = argVal('folder-name', 'Berkshire Letters (Demo)');
const API_BASE = argVal('api', 'http://localhost:8787');
const MAX_PAGES = Number(argVal('max-pages', '0')) || 0;

interface ExtractedSpan {
  start: number;
  end: number;
  page: number;
  text: string;
}

interface Outline {
  text: string;
  spans: ExtractedSpan[];
  pageCount: number;
}

const sha256Hex = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

const extractPdf = async (pdfPath: string): Promise<Outline> => {
  const buf = readFileSync(pdfPath);
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  const pageCount = doc.numPages;
  const limit = MAX_PAGES > 0 ? Math.min(MAX_PAGES, pageCount) : pageCount;
  let cursor = 0;
  const spans: ExtractedSpan[] = [];
  let full = '';
  for (let p = 1; p <= limit; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ('str' in item) {
        const text = item.str;
        if (!text) continue;
        spans.push({ start: cursor, end: cursor + text.length, page: p, text });
        full += text;
        cursor += text.length;
        full += ' ';
        cursor += 1;
      }
    }
    full += '\n';
    cursor += 1;
  }
  return { text: full, spans, pageCount };
};

const main = async () => {
  console.info('Reading fixtures from', FIXTURES_DIR);
  const pdfs = readdirSync(FIXTURES_DIR)
    .filter((n) => n.toLowerCase().endsWith('.pdf'))
    .sort();
  if (pdfs.length === 0) throw new Error(`No PDFs in ${FIXTURES_DIR}`);
  console.info(`Found ${pdfs.length} PDF(s); processing locally...`);

  const sources = [];
  for (const filename of pdfs) {
    const pdfPath = join(FIXTURES_DIR, filename);
    const bytes = readFileSync(pdfPath);
    const contentHash = `sha256:${sha256Hex(bytes)}`;
    const outline = await extractPdf(pdfPath);
    const sourceId = randomUUID();
    sources.push({
      sourceId,
      filename,
      contentHash,
      mime: 'application/pdf',
      sizeBytes: bytes.length,
      modifiedAt: new Date().toISOString(),
      pageCount: outline.pageCount,
      rawBase64: bytes.toString('base64'),
      text: outline.text,
      outline,
    });
    console.info(
      `  ${filename} → sourceId=${sourceId.slice(0, 8)}… ${bytes.length}B, ${outline.pageCount}pp, ${outline.text.length} chars`,
    );
  }

  console.info(`\nPOSTing to ${API_BASE}/__seed/fixtures ...`);
  const res = await fetch(`${API_BASE}/__seed/fixtures`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderId: DEMO_FOLDER_ID,
      userId: DEMO_USER_ID,
      driveFolderId: DEMO_DRIVE_FOLDER_ID,
      folderName: DEMO_FOLDER_NAME,
      sources,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`seed endpoint returned ${res.status}: ${text}`);
  }
  const json = await res.json();
  console.info('\nDone:', JSON.stringify(json));
  console.info(`\nNext: trigger startCompile against folderId=${DEMO_FOLDER_ID}`);
};

main().catch((err) => {
  console.error('seed failed:', err);
  process.exit(1);
});
