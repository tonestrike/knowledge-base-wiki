-- Add `perspective` text column to wikis. Persists the user-chosen lens
-- (e.g. "find business opportunities", "novel-writing inspiration") so the
-- compile pipeline's SchemaInferrer, PlanCompile, ResearchSource, DraftPage,
-- and NarrateIndexes prompts can steer their output toward the lens.
--
-- Idempotency: SQLite doesn't support `ADD COLUMN IF NOT EXISTS`. The
-- deploy script tolerates the "duplicate column name" error from re-runs
-- (see scripts/deploy); fresh DBs apply the ALTER cleanly.
ALTER TABLE wikis ADD COLUMN perspective TEXT;
