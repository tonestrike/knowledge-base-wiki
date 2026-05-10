import type { Extractor } from '../application/extract-source.ts';
import { Outline } from '../domain/outline.ts';

// SF8: real CSV parsing — handles quoted fields, embedded commas, escaped
// double-quotes (`""`), and CR/LF line endings. The Drive connector exports
// Google Sheets as CSV; the previous naive `split(',')` produced silently
// wrong text for any cell with a comma or quote. We also log a warning when
// a row's column count doesn't match the header so an operator can spot
// malformed exports.
//
// RFC 4180 grammar, just enough for the Sheets-export shape:
//   record  := field (',' field)* '\r'? '\n'?
//   field   := escaped | non-escaped
//   escaped := '"' (textdata | ',' | CR | LF | '""')* '"'
//   non-escaped := textdata*
const parseCsv = (input: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      // swallow lone CR; CRLF handled by the LF branch
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // Flush the trailing cell/row if input didn't end with a newline.
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

export const createGoogleSheetExtractor = (): Extractor => ({
  async extract({ bytes }) {
    const csv = new TextDecoder().decode(bytes);
    const rows = parseCsv(csv).filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ''));
    const header = rows[0] ?? [];
    const expectedCols = header.length;
    const lines = rows.slice(1).map((row, rowIx) => {
      if (row.length !== expectedCols) {
        // Surface schema drift loudly — prevents downstream "wrong cell under
        // wrong header" hallucinations. We still emit the row using whatever
        // columns we have so the demo doesn't lose data.
        console.warn(
          `[sheet-extractor] row ${rowIx + 2} has ${row.length} cols, header has ${expectedCols}`,
        );
      }
      return row.map((cell, i) => `${header[i] ?? `col${i}`}: ${cell}`).join(', ');
    });
    return {
      text: lines.join('\n'),
      outline: Outline.empty(),
      pageCount: 1,
      pageImages: [],
    };
  },
});
