// Google Slides decks are exported by the connector as application/pdf, so
// reuse the PDF extraction pipeline verbatim.
export { createPdfExtractor as createGoogleSlideExtractor } from './pdf-extractor.ts';
