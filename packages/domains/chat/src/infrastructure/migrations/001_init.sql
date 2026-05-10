CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  wiki_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_user
  ON conversations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_wiki
  ON conversations(wiki_id, created_at DESC);

CREATE TABLE IF NOT EXISTS turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer_segments_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_turns_conversation
  ON turns(conversation_id, created_at ASC);
