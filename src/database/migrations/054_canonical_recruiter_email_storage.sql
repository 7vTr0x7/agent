-- Canonical recruiter email storage: contacts is the single source of truth for email addresses.
ALTER TABLE recruiter_contacts
  ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiter_contacts_company_contact
  ON recruiter_contacts(company_domain, contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recruiter_contacts_contact_id
  ON recruiter_contacts(contact_id);

-- Move every existing recruiter email into the canonical contacts table.
INSERT INTO contacts (company_name, name, email, role, source, verified_at, created_at, updated_at)
SELECT
  rc.company_name,
  rc.full_name,
  LOWER(TRIM(rc.email)),
  rc.title,
  rc.provider,
  CASE WHEN rc.verified THEN rc.updated_at ELSE NULL END,
  rc.created_at,
  rc.updated_at
FROM recruiter_contacts rc
WHERE rc.email IS NOT NULL
  AND BTRIM(rc.email) <> ''
ON CONFLICT (email) DO UPDATE SET
  company_name = COALESCE(NULLIF(contacts.company_name, ''), EXCLUDED.company_name),
  name = COALESCE(contacts.name, EXCLUDED.name),
  role = COALESCE(contacts.role, EXCLUDED.role),
  source = COALESCE(contacts.source, EXCLUDED.source),
  verified_at = COALESCE(contacts.verified_at, EXCLUDED.verified_at),
  updated_at = GREATEST(contacts.updated_at, EXCLUDED.updated_at);

UPDATE recruiter_contacts rc
SET contact_id = c.id
FROM contacts c
WHERE rc.contact_id IS NULL
  AND rc.email IS NOT NULL
  AND LOWER(TRIM(rc.email)) = LOWER(TRIM(c.email));

-- Email must no longer be persisted on recruiter_contacts. Keep the legacy
-- nullable column temporarily for migration compatibility, but make duplicate
-- storage impossible.
UPDATE recruiter_contacts SET email = NULL WHERE email IS NOT NULL;
ALTER TABLE recruiter_contacts
  DROP CONSTRAINT IF EXISTS recruiter_contacts_email_must_be_null;
ALTER TABLE recruiter_contacts
  ADD CONSTRAINT recruiter_contacts_email_must_be_null CHECK (email IS NULL);

-- The canonical contact table already has a unique email constraint.
CREATE INDEX IF NOT EXISTS idx_contacts_email_lower ON contacts(LOWER(email));
