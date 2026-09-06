ALTER TABLE recruiter_outreach_messages
  DROP CONSTRAINT IF EXISTS recruiter_outreach_messages_status_check;

ALTER TABLE recruiter_outreach_messages
  ADD CONSTRAINT recruiter_outreach_messages_status_check
  CHECK (status IN ('PREPARED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'));

ALTER TABLE recruiter_outreach_messages
  ADD COLUMN IF NOT EXISTS send_claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_recruiter_outreach_messages_sendable
  ON recruiter_outreach_messages (status, created_at)
  WHERE status = 'PREPARED';

CREATE INDEX IF NOT EXISTS idx_recruiter_outreach_messages_sent_at
  ON recruiter_outreach_messages (sent_at)
  WHERE status = 'SENT';
