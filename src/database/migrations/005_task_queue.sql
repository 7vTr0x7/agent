CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER')),
  priority INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(255),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_claimable
  ON tasks (priority DESC, available_at ASC, created_at ASC)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_tasks_running
  ON tasks (locked_at)
  WHERE status = 'RUNNING';

CREATE INDEX IF NOT EXISTS idx_tasks_type_status
  ON tasks (task_type, status);

CREATE TABLE IF NOT EXISTS task_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  worker_id VARCHAR(255) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_task_attempt UNIQUE (task_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_task_attempts_task
  ON task_attempts (task_id, started_at DESC);

CREATE TABLE IF NOT EXISTS dead_letter_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  task_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  reason TEXT NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_tasks_type
  ON dead_letter_tasks (task_type, failed_at DESC);
