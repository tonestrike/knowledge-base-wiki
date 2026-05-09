import type { Outline } from '../domain/outline.ts';
import type { SourceMime } from '../domain/source.ts';

export interface ExtractedSource {
  readonly text: string;
  readonly outline: Outline;
  readonly pageCount: number;
  readonly pageImages: ReadonlyArray<{
    readonly pageNumber: number;
    readonly png: Uint8Array;
  }>;
}

export interface Extractor {
  extract(input: { bytes: Uint8Array }): Promise<ExtractedSource>;
}

export interface ExtractorRegistry {
  readonly pdf: Extractor;
  readonly doc: Extractor;
  readonly sheet: Extractor;
  readonly slide: Extractor;
}

export interface ExtractSourceInput {
  readonly mime: SourceMime;
  readonly bytes: Uint8Array;
}

export async function extractSource(
  extractors: ExtractorRegistry,
  input: ExtractSourceInput,
): Promise<ExtractedSource> {
  switch (input.mime) {
    case 'application/pdf':
    case 'text/plain':
    case 'text/markdown':
      return extractors.pdf.extract({ bytes: input.bytes });
    case 'application/vnd.google-apps.document':
      return extractors.doc.extract({ bytes: input.bytes });
    case 'application/vnd.google-apps.spreadsheet':
      return extractors.sheet.extract({ bytes: input.bytes });
    case 'application/vnd.google-apps.presentation':
      return extractors.slide.extract({ bytes: input.bytes });
    default: {
      const _exhaustive: never = input.mime;
      throw new Error(`unsupported mime: ${String(_exhaustive)}`);
    }
  }
}
