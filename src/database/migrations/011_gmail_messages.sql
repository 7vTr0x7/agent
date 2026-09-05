CREATE TABLE IF NOT EXISTS gmail_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id TEXT NOT NULL UNIQUE,
  gmail_thread_id TEXT NOT NULL,
  rfc_message_id TEXT,
  in_reply_to TEXT,
  sender_email TEXT,
  sender_name TEXT,
  recipient_email TEXT,
  subject TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ,
  snippet TEXT,
  body_text TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT 'OTHER'
    CHECK (classification IN ('APPLICATION_CONFIRMATION','INTERVIEW','POSITIVE','REJECTION','OTHER')),
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gmail_messages_thread
  ON gmail_messages (gmail_thread_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_gmail_messages_application
  ON gmail_messages (application_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_gmail_messages_classification
  ON gmail_messages (classification, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_gmail_messages_sender
  ON gmail_messages (sender_email, received_at DESC);
