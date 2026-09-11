-- Phase 6 mailbox verification invariant.
-- Public-source, MX-only, and legacy boolean verification never authorize real sending.

UPDATE recruiter_contacts
SET
  mailbox_evidence = CASE
    WHEN mailbox_evidence = TRUE
      AND LOWER(COALESCE(verification_status,'')) IN ('mailbox_verified','verified_mailbox','verified')
      AND LOWER(COALESCE(verification_status,'')) NOT IN ('verified_public_source','domain_mx_verified','domain_mx_verified_doh','unverified_public_source')
    THEN TRUE
    ELSE FALSE
  END,
  verification_status = CASE
    WHEN mailbox_evidence = TRUE
      AND LOWER(COALESCE(verification_status,'')) IN ('mailbox_verified','verified_mailbox','verified')
      AND LOWER(COALESCE(verification_status,'')) NOT IN ('verified_public_source','domain_mx_verified','domain_mx_verified_doh','unverified_public_source')
    THEN 'mailbox_verified'
    WHEN LOWER(COALESCE(verification_status,'')) IN ('verified_public_source','domain_mx_verified','domain_mx_verified_doh','unverified_public_source','verified_mailbox','verified','valid')
    THEN CASE
      WHEN LOWER(COALESCE(verification_status,'')) IN ('domain_mx_verified','domain_mx_verified_doh') THEN LOWER(verification_status)
      WHEN LOWER(COALESCE(verification_status,'')) IN ('verified_public_source','unverified_public_source') THEN LOWER(verification_status)
      ELSE 'UNVERIFIED'
    END
    ELSE verification_status
  END;

UPDATE recruiter_contacts
SET
  verified = CASE WHEN mailbox_evidence = TRUE AND LOWER(COALESCE(verification_status,'')) = 'mailbox_verified' THEN TRUE ELSE FALSE END,
  email_status = CASE
    WHEN mailbox_evidence = TRUE AND LOWER(COALESCE(verification_status,'')) = 'mailbox_verified' THEN 'VERIFIED'
    WHEN LOWER(COALESCE(verification_status,'')) IN ('domain_mx_verified','domain_mx_verified_doh') THEN 'LIKELY'
    WHEN LOWER(COALESCE(verification_status,'')) IN ('invalid','invalid_email_format','no_mx_record','missing_email_domain','not_valid') THEN 'INVALID'
    ELSE COALESCE(NULLIF(email_status,'VERIFIED'),'UNVERIFIED')
  END;

ALTER TABLE recruiter_contacts
  DROP CONSTRAINT IF EXISTS recruiter_contacts_mailbox_verification_check,
  DROP CONSTRAINT IF EXISTS recruiter_contacts_verified_mailbox_evidence_check,
  DROP CONSTRAINT IF EXISTS recruiter_contacts_verified_email_status_check;

ALTER TABLE recruiter_contacts
  ADD CONSTRAINT recruiter_contacts_mailbox_verification_check
    CHECK (
      NOT verified
      OR (
        mailbox_evidence = TRUE
        AND email_status = 'VERIFIED'
        AND LOWER(COALESCE(verification_status,'')) = 'mailbox_verified'
      )
    ),
  ADD CONSTRAINT recruiter_contacts_verified_mailbox_evidence_check
    CHECK (email_status <> 'VERIFIED' OR (mailbox_evidence = TRUE AND LOWER(COALESCE(verification_status,'')) = 'mailbox_verified')),
  ADD CONSTRAINT recruiter_contacts_verified_email_status_check
    CHECK (NOT verified OR email_status = 'VERIFIED');

CREATE INDEX IF NOT EXISTS idx_recruiter_contacts_phase6_real_send
  ON recruiter_contacts (company_domain, relevance_status, email_status, mailbox_evidence, suppressed, updated_at DESC);
