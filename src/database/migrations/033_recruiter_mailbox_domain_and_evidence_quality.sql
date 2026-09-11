-- Phase 6 strict mailbox safety invariant.
-- Migration 032 remains authoritative for the existing mailbox-evidence contract;
-- this migration only tightens it for malformed whitespace evidence and mismatched domains.

UPDATE recruiter_contacts
SET
  mailbox_evidence = FALSE,
  verified = FALSE,
  verification_status = CASE WHEN LOWER(COALESCE(verification_status,'')) = 'mailbox_verified' THEN 'UNVERIFIED' ELSE verification_status END,
  email_status = CASE WHEN UPPER(COALESCE(email_status,'')) = 'VERIFIED' THEN 'UNVERIFIED' ELSE email_status END,
  updated_at = NOW()
WHERE verified = TRUE
  AND (
    email IS NULL
    OR email !~* '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
    OR LOWER(SPLIT_PART(email,'@',2)) <> LOWER(company_domain)
  );

CREATE OR REPLACE FUNCTION job_agent_has_quality_mailbox_evidence(evidence jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(COALESCE(evidence,'[]'::jsonb)) = 'array'
        THEN COALESCE(evidence,'[]'::jsonb)
        ELSE '[]'::jsonb
      END
    ) AS item
    WHERE jsonb_typeof(item) = 'object'
      AND item->>'mailboxLevel' = 'true'
      AND NULLIF(BTRIM(item->>'provider'),'') IS NOT NULL
      AND NULLIF(BTRIM(item->>'status'),'') IS NOT NULL
  );
$$;

ALTER TABLE recruiter_contacts
  DROP CONSTRAINT IF EXISTS recruiter_contacts_verified_mailbox_domain_check,
  DROP CONSTRAINT IF EXISTS recruiter_contacts_verified_mailbox_evidence_strict_check;

ALTER TABLE recruiter_contacts
  ADD CONSTRAINT recruiter_contacts_verified_mailbox_domain_check
    CHECK (
      NOT verified
      OR (
        email IS NOT NULL
        AND email ~* '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
        AND LOWER(SPLIT_PART(email,'@',2)) = LOWER(company_domain)
      )
    ),
  ADD CONSTRAINT recruiter_contacts_verified_mailbox_evidence_strict_check
    CHECK (NOT verified OR job_agent_has_quality_mailbox_evidence(verification_evidence));
