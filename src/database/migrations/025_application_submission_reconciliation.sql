-- Make application submission outcomes explicit and durable.
-- Existing records are intentionally not rewritten here; runtime reconciliation
-- classifies stale records from the evidence that is actually persisted.
ALTER TABLE applications
  DROP CONSTRAINT IF EXISTS applications_status_check;

ALTER TABLE applications
  ADD CONSTRAINT applications_status_check
  CHECK (
    status IN (
      'DISCOVERED',
      'MATCHED',
      'READY',
      'DRAFTED',
      'SUBMISSION_IN_PROGRESS',
      'SUBMISSION_UNKNOWN',
      'SUBMISSION_FAILED',
      'SENT',
      'FOLLOW_UP_DUE',
      'RESPONDED',
      'REJECTED',
      'WITHDRAWN',
      'CLOSED'
    )
  );

ALTER TABLE application_attempts
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(30),
  ADD COLUMN IF NOT EXISTS phase VARCHAR(30),
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worker_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS target_url TEXT,
  ADD COLUMN IF NOT EXISTS final_url TEXT,
  ADD COLUMN IF NOT EXISTS response_status INTEGER,
  ADD COLUMN IF NOT EXISTS submission_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS request_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmation_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ambiguity_reason TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE application_attempts
  DROP CONSTRAINT IF EXISTS application_attempts_outcome_check,
  DROP CONSTRAINT IF EXISTS application_attempts_phase_check;

ALTER TABLE application_attempts
  ADD CONSTRAINT application_attempts_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('NOT_SUBMITTED', 'CONFIRMED_SUCCESS', 'DEFINITIVE_FAILURE', 'AMBIGUOUS')),
  ADD CONSTRAINT application_attempts_phase_check
  CHECK (phase IS NULL OR phase IN ('RESERVED', 'EXECUTING', 'REQUEST_OBSERVED', 'CONFIRMING', 'FINALIZED'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_application_attempts_idempotency_key
  ON application_attempts (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_application_attempts_outcome
  ON application_attempts (application_id, outcome, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_application_attempts_task
  ON application_attempts (task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_applications_submission_unknown
  ON applications (status)
  WHERE status = 'SUBMISSION_UNKNOWN';

CREATE INDEX IF NOT EXISTS idx_applications_submission_failed
  ON applications (status)
  WHERE status = 'SUBMISSION_FAILED';
