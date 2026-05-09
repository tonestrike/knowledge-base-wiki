# ingestion — ubiquitous language

This is the canonical glossary for the **ingestion** bounded context. Every term used in code under `packages/domains/ingestion/` MUST appear here. cspell enforces this via `.cspell/glossary.txt` with `addWords: false` — adding a new term requires editing both files in the same PR.

## Aggregate

`Source` is the aggregate root. A `Source` is created once per (Drive file, content hash) pair and never mutated. If the underlying Drive file changes, a new `Source` is created.

## Terms

| Term | Definition | Notes |
|---|---|---|
| Folder | A Google Drive folder URL or ID submitted as the unit of compilation input. | Not a directory on disk. |
| Source | An immutable record of a single fetched document at a point in time. Has an id, a content hash, fetched-at timestamp, and a `Manifest`. | Aggregate root. Never mutated. |
| Manifest | The metadata for a `Source`: filename, MIME type, original Drive id, file size, last-modified-at, page count for paginated docs. | |
| Extraction | The result of processing a `Source`'s bytes into queryable representations: plain text, `Outline`, page images. | |
| Outline | The structural skeleton of a `Source` — nested headings, sections, tables, figures. | |
| Span | A stable, byte-anchored slice of a `Source`: `(sourceId, byteRange, contentHash)`. Identity is rooted in content hash. | Crosses the contracts seam into wiki and verification. |
| Page | For paginated formats (PDF, Slides), a 1-indexed integer locating a `Span` in the rendered document. | Distinct from `WikiPage` in the wiki context. |
| Connector | The integration that fetches `Source`s from a backing system. Currently: `GoogleDriveConnector`. | |
| Fetch | The operation a `Connector` performs to produce a `Source`. | |

## Banned synonyms

| Don't write | Write |
|---|---|
| file | Source (we don't track Drive files; we track immutable extracted snapshots) |
| chunk | Span (chunk implies vector retrieval; we don't chunk for embedding) |
| document | Source (too generic) |
| snippet | Span or Outline section |
| download | Fetch |
| metadata (alone) | Manifest |

## Cross-context notes

- `Source` is owned here. The wiki context refers to a `Source` via `Citation`, never directly.
- `Span` is owned here as a value object. It crosses the contracts seam to wiki and verification via `@package/contracts/shared`.
- `Page` here means a PDF/Slide page integer. The wiki context's `WikiPage` is a different concept — see `docs/ubiquitous-language.md` cross-references.
