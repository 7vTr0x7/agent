-- Ensure already-migrated databases no longer enforce legacy recruiter email storage.
-- Migration 054 moves canonical email storage to contacts; these legacy constraints
-- would otherwise reject verified recruiter rows whose recruiter_contacts.email is NULL.
ALTER TABLE recruiter_contacts
  DROP CONSTRAINT IF EXISTS recruiter_contacts_mailbox_verification_check,
  DROP CONSTRAINT IF EXISTS recruiter_contacts_verified_mailbox_domain_check;

ALTER TABLE recruiter_contacts
  DROP CONSTRAINT IF EXISTS recruiter_contacts_email_must_be_null;

ALTER TABLE recruiter_contacts
  ADD CONSTRAINT recruiter_contacts_email_must_be_null CHECK (email IS NULL);
