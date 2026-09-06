ALTER TABLE recruiter_outreach_sequences
  ADD COLUMN IF NOT EXISTS follow_up_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE recruiter_outreach_sequences
  ADD CONSTRAINT recruiter_outreach_sequences_follow_up_count_check
  CHECK (follow_up_count >= 0);

CREATE INDEX IF NOT EXISTS idx_recruiter_outreach_follow_up_due
  ON recruiter_outreach_sequences (next_action_at)
  WHERE status = 'ACTIVE' AND next_action_at IS NOT NULL;
