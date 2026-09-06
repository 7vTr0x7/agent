ALTER TABLE interviews
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_interviews_due_reminders
  ON interviews (status, reminder_at, reminder_sent_at);
