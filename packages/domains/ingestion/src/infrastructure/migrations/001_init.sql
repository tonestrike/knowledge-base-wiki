-- ingestion: initial schema for folders, sources, oauth_tokens
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  drive_folder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, drive_folder_id)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  drive_file_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  modified_at TEXT NOT NULL,
  page_count INTEGER,
  content_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE (folder_id, drive_file_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_sources_folder ON sources(folder_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'google',
  encrypted_refresh_token TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
