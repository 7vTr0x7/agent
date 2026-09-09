-- Ensure recruiter outreach UPSERT targets are backed by unique indexes even when
-- an older database was initialized before the corresponding constraints existed.
-- These indexes are intentionally separate from the named constraints created by
-- the original migration so ON CONFLICT inference works on every supported DB.

CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiter_contact_email_domain_idx
  ON recruiter_contacts (company_domain, email);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiter_contact_source_idx
  ON recruiter_contact_sources (recruiter_contact_id, provider, source_url);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiter_outreach_sequence_idx
  ON recruiter_outreach_sequences (recruiter_contact_id, job_opportunity_id, candidate_profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiter_outreach_message_step_idx
  ON recruiter_outreach_messages (sequence_id, sequence_step);
