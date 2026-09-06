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
      'SENT',
      'FOLLOW_UP_DUE',
      'RESPONDED',
      'REJECTED',
      'WITHDRAWN',
      'CLOSED'
    )
  );

CREATE INDEX IF NOT EXISTS idx_applications_submission_in_progress
  ON applications (status)
  WHERE status = 'SUBMISSION_IN_PROGRESS';
