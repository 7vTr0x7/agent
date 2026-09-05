ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_dedupe_key_active
  ON tasks (dedupe_key)
  WHERE dedupe_key IS NOT NULL
    AND status IN ('PENDING', 'RUNNING');

CREATE INDEX IF NOT EXISTS idx_tasks_expired_leases
  ON tasks (lease_expires_at)
  WHERE status = 'RUNNING';
