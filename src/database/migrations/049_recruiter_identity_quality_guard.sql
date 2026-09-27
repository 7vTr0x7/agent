-- Reject recruiter records whose public-web employer identity is clearly search-page/UI chrome
-- or whose employer domain contradicts a non-generic recruiter email domain. Generic
-- mailbox providers do not establish employer identity, so they are stored as
-- unverified public-web evidence rather than treated as an employer-domain conflict.

CREATE OR REPLACE FUNCTION recruiter_identity_quality_consistent(
  provider_value TEXT,
  full_name_value TEXT,
  linkedin_profile_url_value TEXT,
  company_name_value TEXT,
  company_domain_value TEXT,
  email_value TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  company_domain TEXT;
  email_domain TEXT;
BEGIN
  IF COALESCE(provider_value, '') <> 'proactive-public-web' THEN
    RETURN TRUE;
  END IF;

  IF COALESCE(company_name_value, '') ~* '(email\s+or\s+phone|password|forgot\s+password|show\s+password|linkedin\s+facebook\s+x|copy\s+linkedin|skip\s+to|navigation)' THEN
    RETURN FALSE;
  END IF;

  company_domain := lower(regexp_replace(btrim(COALESCE(company_domain_value, '')), '^www\\.', '', 'i'));
  email_domain := lower(split_part(btrim(COALESCE(email_value, '')), '@', 2));

  IF email_domain <> '' AND company_domain <> ''
     AND email_domain NOT IN ('gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','yahoo.co.in','icloud.com','proton.me','protonmail.com')
     AND email_domain <> company_domain THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION guard_proactive_recruiter_identity_quality()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT recruiter_identity_quality_consistent(
    NEW.provider,
    NEW.full_name,
    NEW.linkedin_profile_url,
    NEW.company_name,
    NEW.company_domain,
    NEW.email
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_proactive_recruiter_identity_quality ON recruiter_contacts;
CREATE TRIGGER trg_guard_proactive_recruiter_identity_quality
BEFORE INSERT OR UPDATE OF full_name, linkedin_profile_url, company_name, company_domain, email, provider
ON recruiter_contacts
FOR EACH ROW
EXECUTE FUNCTION guard_proactive_recruiter_identity_quality();

-- Remove only malformed proactive-public-web rows covered by the narrow quality guard.
DELETE FROM recruiter_contacts
 WHERE COALESCE(provider, '') = 'proactive-public-web'
   AND NOT recruiter_identity_quality_consistent(
     provider,
     full_name,
     linkedin_profile_url,
     company_name,
     company_domain,
     email
   );
