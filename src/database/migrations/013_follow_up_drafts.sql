CREATE TABLE IF NOT EXISTS follow_up_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','APPROVED','SENT','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_follow_up_drafts_application UNIQUE (application_id)
);

CREATE INDEX IF NOT EXISTS idx_follow_up_drafts_status
  ON follow_up_drafts (status, created_at DESC);
