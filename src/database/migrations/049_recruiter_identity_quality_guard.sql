-- Reject recruiter records whose public-web employer identity is clearly search-page/UI chrome
-- or whose employer domain contradicts the supplied recruiter email domain. These guards are
-- deliberately narrow: they protect persistence from parser contamination without inventing
-- or normalizing an employer identity that the public evidence does not establish.

CREATE OR REPLACE FUNCTION recruiter_identity_quality_consistent(
  provider_value TEXT,
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

  IF email_domain <> '' AND company_domain <> '' AND email_domain <> company_domain THEN
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
  IF NOT recruiter_identity_quality_consistent(NEW.provider, NEW.company_name, NEW.company_domain, NEW.email) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_proactive_recruiter_identity_quality ON recruiter_contacts;
CREATE TRIGGER trg_guard_proactive_recruiter_identity_quality
BEFORE INSERT OR UPDATE OF company_name, company_domain, email, provider
ON recruiter_contacts
FOR EACH ROW
EXECUTE FUNCTION guard_proactive_recruiter_identity_quality();

-- Remove only the exact class of malformed proactive-public-web records this guard protects.
DELETE FROM recruiter_contacts
 WHERE COALESCE(provider, '') = 'proactive-public-web'
   AND (
     COALESCE(company_name, '') ~* '(email\s+or\s+phone|password|forgot\s+password|show\s+password|linkedin\s+facebook\s+x|copy\s+linkedin|skip\s+to|navigation)'
     OR (
       NULLIF(btrim(email), '') IS NOT NULL
       AND NULLIF(btrim(company_domain), '') IS NOT NULL
       AND lower(split_part(btrim(email), '@', 2)) <> lower(regexp_replace(btrim(company_domain), '^www\\.', '', 'i'))
     )
   );
