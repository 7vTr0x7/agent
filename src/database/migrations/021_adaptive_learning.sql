CREATE TABLE IF NOT EXISTS ai_learning_policy (
  id VARCHAR(100) PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  sample_size INTEGER NOT NULL DEFAULT 0,
  policy JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_learning_policy_updated_at
  ON ai_learning_policy (updated_at DESC);
