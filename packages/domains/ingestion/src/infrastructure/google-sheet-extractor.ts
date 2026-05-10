import type { Extractor } from '../application/extract-source.ts';
import { Outline } from '../domain/outline.ts';

// The Drive connector exports Google Sheets as CSV. We flatten into one row
// per line so the Drafter sees field names alongside cell values.
// CSV parsing here is intentionally naive (no quoted-comma handling); a real
// implementation would use a CSV library. For the demo, the curated sheets
// avoid quotes/embedded commas.
export const createGoogleSheetExtractor = (): Extractor => ({
  async extract({ bytes }) {
    const csv = new TextDecoder().decode(bytes);
    const lines = csv.split('\n').filter((l) => l.length > 0);
    const header = lines[0]?.split(',') ?? [];
    const rows = lines.slice(1).map((row) =>
      row
        .split(',')
        .map((cell, i) => `${header[i] ?? `col${i}`}: ${cell}`)
        .join(', '),
    );
    return {
      text: rows.join('\n'),
      outline: Outline.empty(),
      pageCount: 1,
      pageImages: [],
    };
  },
});
