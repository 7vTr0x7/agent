ALTER TABLE recruiter_contact_sources
  DROP CONSTRAINT IF EXISTS uq_recruiter_contact_source;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiter_contact_source_normalized
  ON recruiter_contact_sources (recruiter_contact_id, provider, COALESCE(source_url, ''));
