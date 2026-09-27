-- Make proactive recruiter persistence guards fail loudly instead of silently
-- suppressing a row. The predicates remain unchanged; only the failure mode
-- changes from RETURN NULL to an explicit invariant error so INSERT/UPDATE
-- ... RETURNING cannot be mistaken for a successful persistence operation.

CREATE OR REPLACE FUNCTION guard_proactive_recruiter_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.provider, '') = 'proactive-public-web'
     AND COALESCE(NEW.full_name, '') <> 'Employer recruiting contact'
     AND NEW.linkedin_profile_url IS NULL
     AND (
       COALESCE(NEW.title, '') ~* '^\\s*LinkedIn\\s+https?://'
       OR COALESCE(NEW.title, '') ~* 'https?://'
     ) THEN
    RAISE EXCEPTION 'proactive recruiter identity guard rejected contact: title contains URL without LinkedIn profile';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_recruiter_profile_identity_consistency()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  slug text;
  normalized_name text;
  slug_tokens text[];
  name_tokens text[];
  token text;
  meaningful_slug_tokens integer;
  matched_tokens integer := 0;
BEGIN
  IF COALESCE(NEW.provider, '') <> 'proactive-public-web'
     OR NEW.linkedin_profile_url IS NULL
     OR COALESCE(NEW.full_name, '') = ''
     OR NEW.full_name = 'Employer recruiting contact' THEN
    RETURN NEW;
  END IF;

  slug := lower(split_part(split_part(NEW.linkedin_profile_url, '/in/', 2), '?', 1));
  slug := regexp_replace(slug, '[^a-z0-9]+', ' ', 'g');
  normalized_name := lower(regexp_replace(COALESCE(NEW.full_name, ''), '[^a-z0-9]+', ' ', 'g'));
  slug_tokens := regexp_split_to_array(trim(slug), '\\s+');
  name_tokens := regexp_split_to_array(trim(normalized_name), '\\s+');

  meaningful_slug_tokens := 0;
  FOREACH token IN ARRAY slug_tokens LOOP
    IF length(token) >= 4 THEN
      meaningful_slug_tokens := meaningful_slug_tokens + 1;
      IF token = ANY(name_tokens) THEN
        matched_tokens := matched_tokens + 1;
      END IF;
    END IF;
  END LOOP;

  IF meaningful_slug_tokens >= 2 AND matched_tokens = 0 THEN
    RAISE EXCEPTION 'proactive recruiter profile identity guard rejected contact: LinkedIn slug does not match full_name';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_proactive_recruiter_linkedin_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.provider, '') = 'proactive-public-web'
     AND COALESCE(NEW.linkedin_profile_url, '') <> ''
     AND COALESCE(NEW.full_name, '') <> ''
     AND NOT recruiter_linkedin_identity_consistent(NEW.linkedin_profile_url, NEW.full_name)
  THEN
    RAISE EXCEPTION 'proactive recruiter LinkedIn identity consistency guard rejected contact';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_proactive_recruiter_identity_quality()
RETURNS trigger
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
    RAISE EXCEPTION 'proactive recruiter identity quality guard rejected contact';
  END IF;
  RETURN NEW;
END;
$$;
