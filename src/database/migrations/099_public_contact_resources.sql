ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS normalized_email TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_status VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN IF NOT EXISTS relevance_score INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS suppressed BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE contacts
SET normalized_email=LOWER(TRIM(email))
WHERE normalized_email IS NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_normalized_email ON contacts(normalized_email);
CREATE INDEX IF NOT EXISTS idx_contacts_validation_status ON contacts(validation_status);
CREATE INDEX IF NOT EXISTS idx_contacts_relevance_score ON contacts(relevance_score);

CREATE TABLE IF NOT EXISTS public_contact_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL UNIQUE,
  source_type VARCHAR(50) NOT NULL,
  title TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'DISCOVERED',
  records_seen INTEGER NOT NULL DEFAULT 0,
  emails_extracted INTEGER NOT NULL DEFAULT 0,
  emails_normalized INTEGER NOT NULL DEFAULT 0,
  invalid_emails INTEGER NOT NULL DEFAULT 0,
  duplicate_emails INTEGER NOT NULL DEFAULT 0,
  qualified_contacts INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_public_contact_resources_status ON public_contact_resources(status);
CREATE INDEX IF NOT EXISTS idx_public_contact_resources_processed_at ON public_contact_resources(processed_at DESC);
