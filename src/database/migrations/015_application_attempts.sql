CREATE TABLE IF NOT EXISTS application_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  adapter_name TEXT,
  safety_allowed BOOLEAN NOT NULL,
  submitted BOOLEAN NOT NULL,
  reason TEXT NOT NULL,
  confirmation_url TEXT,
  external_application_id TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_attempts_application
  ON application_attempts (application_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_application_attempts_submitted
  ON application_attempts (submitted, attempted_at DESC);
