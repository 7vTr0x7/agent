ALTER TABLE recruiter_outreach_messages
  ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(512),
  ADD COLUMN IF NOT EXISTS send_state VARCHAR(30) NOT NULL DEFAULT 'READY',
  ADD COLUMN IF NOT EXISTS send_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS send_started_at TIMESTAMPTZ;

ALTER TABLE recruiter_outreach_messages
  DROP CONSTRAINT IF EXISTS recruiter_outreach_messages_send_state_check;

ALTER TABLE recruiter_outreach_messages
  ADD CONSTRAINT recruiter_outreach_messages_send_state_check
  CHECK (send_state IN ('READY','SENDING','AMBIGUOUS','SENT','FAILED','CANCELLED'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiter_outreach_client_message_id
  ON recruiter_outreach_messages (client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recruiter_outreach_send_state
  ON recruiter_outreach_messages (send_state, send_started_at)
  WHERE send_state IN ('SENDING','AMBIGUOUS');
