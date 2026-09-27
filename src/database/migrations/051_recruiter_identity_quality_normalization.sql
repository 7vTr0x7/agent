-- Keep the proactive recruiter quality invariant, but normalize employer and
-- recruiter email domains identically to the application path before comparing.
-- In particular, www.example.com and example.com represent the same employer
-- domain. This is a corrective persistence migration, not a diagnostic bypass.

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

  company_domain := lower(btrim(COALESCE(company_domain_value, '')));
  company_domain := regexp_replace(company_domain, '^www\.', '', 1, 1, 'i');
  email_domain := lower(btrim(split_part(COALESCE(email_value, ''), '@', 2)));
  email_domain := regexp_replace(email_domain, '^www\.', '', 1, 1, 'i');

  IF email_domain <> '' AND company_domain <> ''
     AND email_domain NOT IN ('gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','yahoo.co.in','icloud.com','proton.me','protonmail.com')
     AND email_domain <> company_domain THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$;
