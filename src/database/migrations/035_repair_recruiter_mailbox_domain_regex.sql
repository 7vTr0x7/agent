-- Phase 7 hardening: repair the mailbox email-format regex introduced with
-- over-escaped backslashes in the earlier strict domain invariant.
-- Keep the invariant strict without relying on backslash escapes in SQL regex.

ALTER TABLE recruiter_contacts
  DROP CONSTRAINT IF EXISTS recruiter_contacts_verified_mailbox_domain_check;

ALTER TABLE recruiter_contacts
  ADD CONSTRAINT recruiter_contacts_verified_mailbox_domain_check
    CHECK (
      NOT verified
      OR (
        email IS NOT NULL
        AND email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        AND LOWER(SPLIT_PART(email,'@',2)) = LOWER(company_domain)
      )
    );
