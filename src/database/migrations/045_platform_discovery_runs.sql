CREATE TABLE IF NOT EXISTS platform_discovery_runs (
  id BIGSERIAL PRIMARY KEY,
  platform_id VARCHAR(255) NOT NULL,
  platform_name VARCHAR(255) NOT NULL,
  capability VARCHAR(40) NOT NULL,
  outcome VARCHAR(40) NOT NULL,
  extraction_mode VARCHAR(50),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_pages INTEGER NOT NULL DEFAULT 0,
  search_urls_generated INTEGER NOT NULL DEFAULT 0,
  search_returned_urls INTEGER NOT NULL DEFAULT 0,
  unique_urls INTEGER NOT NULL DEFAULT 0,
  fetched INTEGER NOT NULL DEFAULT 0,
  normalized INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  timeouts INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_discovery_runs_platform_completed
  ON platform_discovery_runs(platform_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_discovery_runs_outcome
  ON platform_discovery_runs(outcome, completed_at DESC);
