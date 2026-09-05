CREATE TABLE IF NOT EXISTS interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  gmail_message_id TEXT REFERENCES gmail_messages(gmail_message_id) ON DELETE SET NULL,
  gmail_thread_id TEXT,
  date_text TEXT,
  time_text TEXT,
  timezone TEXT,
  meeting_url TEXT,
  meeting_provider VARCHAR(30),
  status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED','COMPLETED','CANCELLED')),
  reminder_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_interviews_gmail_message UNIQUE (gmail_message_id)
);

CREATE INDEX IF NOT EXISTS idx_interviews_application
  ON interviews (application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_interviews_reminder
  ON interviews (status, reminder_at);
