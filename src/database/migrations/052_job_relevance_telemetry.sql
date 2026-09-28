CREATE TABLE IF NOT EXISTS job_relevance_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id VARCHAR(100) NOT NULL,
  discovered_count INTEGER NOT NULL DEFAULT 0 CHECK (discovered_count >= 0),
  normalized_count INTEGER NOT NULL DEFAULT 0 CHECK (normalized_count >= 0),
  hard_rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (hard_rejected_count >= 0),
  ambiguous_count INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous_count >= 0),
  eligible_count INTEGER NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  rejection_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
  accepted_role_families JSONB NOT NULL DEFAULT '{}'::jsonb,
  rejected_samples JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_relevance_runs_source_created
  ON job_relevance_runs (source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_relevance_runs_created
  ON job_relevance_runs (created_at DESC);
