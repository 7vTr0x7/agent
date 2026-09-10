ALTER TABLE recruiter_contacts
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE recruiter_contacts
  ADD COLUMN IF NOT EXISTS linkedin_profile_url TEXT,
  ADD COLUMN IF NOT EXISTS identity_key TEXT,
  ADD COLUMN IF NOT EXISTS email_discovery_status VARCHAR(20) NOT NULL DEFAULT 'FOUND',
  ADD COLUMN IF NOT EXISTS email_discovery_attempted_at TIMESTAMPTZ;

UPDATE recruiter_contacts
SET identity_key = CONCAT('email:', LOWER(email))
WHERE identity_key IS NULL AND email IS NOT NULL;

UPDATE recruiter_contacts
SET email_discovery_status = CASE WHEN email IS NULL THEN 'PENDING' ELSE 'FOUND' END
WHERE email_discovery_status IS NULL OR email_discovery_status NOT IN ('PENDING','FOUND','NOT_FOUND','INVALID');

ALTER TABLE recruiter_contacts
  DROP CONSTRAINT IF EXISTS recruiter_contacts_email_discovery_status_check;

ALTER TABLE recruiter_contacts
  ADD CONSTRAINT recruiter_contacts_email_discovery_status_check
  CHECK (email_discovery_status IN ('PENDING','FOUND','NOT_FOUND','INVALID'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiter_contact_identity_key
  ON recruiter_contacts (company_domain, identity_key)
  WHERE identity_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiter_contact_profile
  ON recruiter_contacts (company_domain, LOWER(linkedin_profile_url))
  WHERE linkedin_profile_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recruiter_contacts_email_discovery
  ON recruiter_contacts (company_domain, email_discovery_status, updated_at DESC);
