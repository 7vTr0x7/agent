ALTER TABLE job_opportunities
  ADD COLUMN IF NOT EXISTS company_domain TEXT;

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS candidate_profile_id VARCHAR(100);

UPDATE applications
SET candidate_profile_id = 'default'
WHERE candidate_profile_id IS NULL;

ALTER TABLE applications
  ALTER COLUMN candidate_profile_id SET DEFAULT 'default';

ALTER TABLE applications
  ALTER COLUMN candidate_profile_id SET NOT NULL;

ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_status_check;

ALTER TABLE applications
  ADD CONSTRAINT applications_status_check CHECK (
    status IN (
      'DISCOVERED',
      'MATCHED',
      'READY',
      'DRAFTED',
      'SUBMISSION_IN_PROGRESS',
      'SENT',
      'FOLLOW_UP_DUE',
      'RESPONDED',
      'REJECTED',
      'WITHDRAWN',
      'CLOSED'
    )
  );

CREATE INDEX IF NOT EXISTS idx_applications_candidate_profile_status
  ON applications (candidate_profile_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS application_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  adapter_name VARCHAR(100),
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
