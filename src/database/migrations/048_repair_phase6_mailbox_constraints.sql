-- Repair migration for Phase 6 mailbox safety constraints.
-- The Phase 6 contract requires all seven named CHECK constraints to be present
-- and validated. This migration is idempotent so an already-correct database is
-- unchanged, while a partially-applied historical migration set is repaired.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recruiter_contacts'::regclass
      AND conname = 'recruiter_contacts_mailbox_verification_check'
  ) THEN
    ALTER TABLE recruiter_contacts
      ADD CONSTRAINT recruiter_contacts_mailbox_verification_check
      CHECK (
        NOT verified
        OR (
          mailbox_evidence = TRUE
          AND email_status = 'VERIFIED'
          AND LOWER(COALESCE(verification_status,'')) = 'mailbox_verified'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recruiter_contacts'::regclass
      AND conname = 'recruiter_contacts_verified_mailbox_evidence_check'
  ) THEN
    ALTER TABLE recruiter_contacts
      ADD CONSTRAINT recruiter_contacts_verified_mailbox_evidence_check
      CHECK (
        email_status <> 'VERIFIED'
        OR (
          mailbox_evidence = TRUE
          AND LOWER(COALESCE(verification_status,'')) = 'mailbox_verified'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recruiter_contacts'::regclass
      AND conname = 'recruiter_contacts_verified_email_status_check'
  ) THEN
    ALTER TABLE recruiter_contacts
      ADD CONSTRAINT recruiter_contacts_verified_email_status_check
      CHECK (NOT verified OR email_status = 'VERIFIED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recruiter_contacts'::regclass
      AND conname = 'recruiter_contacts_mailbox_verification_evidence_check'
  ) THEN
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
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recruiter_contacts'::regclass
      AND conname = 'recruiter_contacts_mailbox_verification_evidence_quality_check'
  ) THEN
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
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recruiter_contacts'::regclass
      AND conname = 'recruiter_contacts_verified_mailbox_domain_check'
  ) THEN
    ALTER TABLE recruiter_contacts
      ADD CONSTRAINT recruiter_contacts_verified_mailbox_domain_check
      CHECK (
        NOT verified
        OR (
          email IS NOT NULL
          AND email ~* '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
          AND LOWER(SPLIT_PART(email,'@',2)) = LOWER(company_domain)
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recruiter_contacts'::regclass
      AND conname = 'recruiter_contacts_mailbox_verification_evidence_strict_check'
  ) THEN
    ALTER TABLE recruiter_contacts
      ADD CONSTRAINT recruiter_contacts_mailbox_verification_evidence_strict_check
      CHECK (NOT verified OR job_agent_has_quality_mailbox_evidence(verification_evidence));
  END IF;
END
$$;
