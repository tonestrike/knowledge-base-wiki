CREATE TABLE IF NOT EXISTS lint_runs (
  id TEXT PRIMARY KEY,
  wiki_id TEXT NOT NULL,
  status TEXT NOT NULL,
  total_claims INTEGER NOT NULL,
  audited INTEGER NOT NULL DEFAULT 0,
  unsupported_count INTEGER NOT NULL DEFAULT 0,
  contradicted_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  failure_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_lint_runs_wiki ON lint_runs(wiki_id, started_at DESC);

CREATE TABLE IF NOT EXISTS lint_findings (
  id TEXT PRIMARY KEY,
  lint_run_id TEXT NOT NULL REFERENCES lint_runs(id) ON DELETE CASCADE,
  wiki_page_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  claim_json TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('supported','unsupported','contradicted')),
  evidence_text TEXT NOT NULL,
  cited_spans_json TEXT NOT NULL,
  correction_json TEXT,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_findings_run_verdict ON lint_findings(lint_run_id, verdict);
