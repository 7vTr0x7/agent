CREATE TABLE IF NOT EXISTS sources (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'APPROVED'
    CHECK (status IN ('APPROVED', 'REVIEW_REQUIRED', 'DISABLED')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_run_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  disabled_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_status ON sources (status);

CREATE TABLE IF NOT EXISTS source_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id VARCHAR(100) NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  fetched_count INTEGER NOT NULL DEFAULT 0 CHECK (fetched_count >= 0),
  inserted_count INTEGER NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_runs_source_started
  ON source_runs (source_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_runs_status
  ON source_runs (status);

CREATE TABLE IF NOT EXISTS source_errors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_run_id UUID REFERENCES source_runs(id) ON DELETE CASCADE,
  source_id VARCHAR(100) NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  classification VARCHAR(30) NOT NULL
    CHECK (classification IN ('TRANSIENT', 'PERMANENT', 'INVALID_DATA', 'RATE_LIMIT', 'UNKNOWN')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  message TEXT NOT NULL,
  status_code INTEGER,
  retry_after_seconds INTEGER CHECK (retry_after_seconds IS NULL OR retry_after_seconds >= 0),
  next_retry_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_errors_source_created
  ON source_errors (source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_errors_retry
  ON source_errors (next_retry_at)
  WHERE next_retry_at IS NOT NULL;
