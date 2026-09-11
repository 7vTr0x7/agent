-- Phase 6 mailbox evidence quality invariant.
-- Non-empty JSON evidence is not sufficient for real sending: at least one
-- evidence item must explicitly identify mailbox-level verification.

UPDATE recruiter_contacts
SET
  mailbox_evidence = FALSE,
  verified = FALSE,
  verification_status = CASE
    WHEN LOWER(COALESCE(verification_status,'')) = 'mailbox_verified' THEN 'UNVERIFIED'
    ELSE verification_status
  END,
  email_status = CASE
    WHEN UPPER(COALESCE(email_status,'')) = 'VERIFIED' THEN 'UNVERIFIED'
    ELSE email_status
  END,
  updated_at = NOW()
WHERE (
    mailbox_evidence = TRUE
    OR verified = TRUE
    OR UPPER(COALESCE(email_status,'')) = 'VERIFIED'
  )
  AND NOT COALESCE(verification_evidence,'[]'::jsonb) @? '$[*] ? (@.mailboxLevel == true && @.provider != "" && @.status != "")';

ALTER TABLE recruiter_contacts
  DROP CONSTRAINT IF EXISTS recruiter_contacts_mailbox_verification_evidence_quality_check;

ALTER TABLE recruiter_contacts
  ADD CONSTRAINT recruiter_contacts_mailbox_verification_evidence_quality_check
    CHECK (
      NOT verified
      OR (
        mailbox_evidence = TRUE
        AND UPPER(COALESCE(email_status,'')) = 'VERIFIED'
        AND LOWER(COALESCE(verification_status,'')) = 'mailbox_verified'
        AND jsonb_typeof(COALESCE(verification_evidence,'[]'::jsonb)) = 'array'
        AND COALESCE(verification_evidence,'[]'::jsonb) @? '$[*] ? (@.mailboxLevel == true && @.provider != "" && @.status != "")'
      )
    );
