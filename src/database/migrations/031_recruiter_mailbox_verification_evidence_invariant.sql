-- Phase 6 mailbox verification evidence invariant.
-- A real-send mailbox verification must have explicit non-empty verification evidence.
-- This migration conservatively downgrades any historical rows that claim mailbox verification without evidence.

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
  AND jsonb_array_length(
    CASE
      WHEN jsonb_typeof(COALESCE(verification_evidence,'[]'::jsonb)) = 'array'
      THEN COALESCE(verification_evidence,'[]'::jsonb)
      ELSE '[]'::jsonb
    END
  ) = 0;

ALTER TABLE recruiter_contacts
  DROP CONSTRAINT IF EXISTS recruiter_contacts_mailbox_verification_evidence_check;

ALTER TABLE recruiter_contacts
  ADD CONSTRAINT recruiter_contacts_mailbox_verification_evidence_check
    CHECK (
      NOT verified
      OR (
        mailbox_evidence = TRUE
        AND UPPER(COALESCE(email_status,'')) = 'VERIFIED'
        AND LOWER(COALESCE(verification_status,'')) = 'mailbox_verified'
        AND jsonb_typeof(COALESCE(verification_evidence,'[]'::jsonb)) = 'array'
        AND jsonb_array_length(
          CASE
            WHEN jsonb_typeof(COALESCE(verification_evidence,'[]'::jsonb)) = 'array'
            THEN COALESCE(verification_evidence,'[]'::jsonb)
            ELSE '[]'::jsonb
          END
        ) > 0
      )
    );
