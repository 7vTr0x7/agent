ALTER TABLE gmail_messages
  ADD COLUMN IF NOT EXISTS recruiter_inbound_processing_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recruiter_inbound_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recruiter_inbound_outcome VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_gmail_messages_recruiter_inbound_processing
  ON gmail_messages (recruiter_inbound_processing_at)
  WHERE recruiter_inbound_processed_at IS NULL;
