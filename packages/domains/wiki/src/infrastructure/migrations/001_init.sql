CREATE TABLE IF NOT EXISTS wikis (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL UNIQUE,
  schema_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_compiled_at TEXT,
  page_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wiki_pages (
  id TEXT PRIMARY KEY,
  wiki_id TEXT NOT NULL REFERENCES wikis(id) ON DELETE CASCADE,
  subtype TEXT NOT NULL CHECK (subtype IN ('Concept','Summary','Answer','Index')),
  page_type TEXT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body_r2_key TEXT NOT NULL,
  source_id TEXT,
  question TEXT,
  index_entries_json TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (wiki_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_pages_wiki_subtype ON wiki_pages(wiki_id, subtype);
CREATE INDEX IF NOT EXISTS idx_pages_wiki_pagetype ON wiki_pages(wiki_id, page_type);
CREATE INDEX IF NOT EXISTS idx_pages_updated_at ON wiki_pages(updated_at);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY,
  wiki_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  paragraph_id TEXT NOT NULL,
  claim_text TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_page ON claims(wiki_page_id);

CREATE TABLE IF NOT EXISTS citations (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  byte_range_start INTEGER NOT NULL,
  byte_range_end INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  label TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_citations_claim ON citations(claim_id);

CREATE TABLE IF NOT EXISTS backlinks (
  from_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  to_page_id TEXT NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
  relation_name TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (from_page_id, to_page_id, relation_name)
);

CREATE TABLE IF NOT EXISTS compile_runs (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  wiki_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  schema_inferred_at TEXT,
  failure_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_folder ON compile_runs(folder_id);
