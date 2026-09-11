ALTER TABLE recruiter_contacts
  ADD COLUMN IF NOT EXISTS discovery_source VARCHAR(100),
  ADD COLUMN IF NOT EXISTS email_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS domain_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS mx_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS mailbox_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verification_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS suppressed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suppression_reason VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ;

UPDATE recruiter_contacts
SET discovery_source = COALESCE(discovery_source, provider),
    email_status = COALESCE(email_status, CASE
      WHEN email IS NULL THEN 'UNVERIFIED'
      WHEN verification_status IN ('verified_public_source','mailbox_verified') THEN 'VERIFIED'
      WHEN verification_status IN ('domain_mx_verified','domain_mx_verified_doh') THEN 'LIKELY'
      WHEN verification_status IN ('invalid_email_format','no_mx_record','missing_email_domain') THEN 'INVALID'
      ELSE 'UNVERIFIED'
    END)
WHERE discovery_source IS NULL OR email_status IS NULL;

ALTER TABLE recruiter_contacts
  DROP CONSTRAINT IF EXISTS recruiter_contacts_email_status_check,
  DROP CONSTRAINT IF EXISTS recruiter_contacts_domain_status_check,
  DROP CONSTRAINT IF EXISTS recruiter_contacts_mx_status_check;

ALTER TABLE recruiter_contacts
  ADD CONSTRAINT recruiter_contacts_email_status_check
    CHECK (email_status IS NULL OR email_status IN ('VERIFIED','LIKELY','UNVERIFIED','INVALID','SUPPRESSED')),
  ADD CONSTRAINT recruiter_contacts_domain_status_check
    CHECK (domain_status IN ('VALID','INVALID','UNKNOWN')),
  ADD CONSTRAINT recruiter_contacts_mx_status_check
    CHECK (mx_status IN ('EXISTS','MISSING','UNKNOWN'));

CREATE INDEX IF NOT EXISTS idx_recruiter_contacts_selection
  ON recruiter_contacts (company_domain, suppressed, email_status, confidence DESC NULLS LAST, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_recruiter_contacts_last_contacted
  ON recruiter_contacts (last_contacted_at DESC NULLS LAST);
