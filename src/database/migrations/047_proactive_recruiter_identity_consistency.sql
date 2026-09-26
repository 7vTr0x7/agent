-- Reject proactive recruiter identities when a LinkedIn profile slug contradicts the person name.
-- Search-result pages can contain multiple people; persistence must never silently bind one
-- person's name to another person's LinkedIn profile.

CREATE OR REPLACE FUNCTION recruiter_linkedin_identity_consistent(
  profile_url TEXT,
  full_name TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  slug TEXT;
  profile_name TEXT;
  name_tokens TEXT[];
  token TEXT;
BEGIN
  IF profile_url IS NULL OR btrim(profile_url) = '' OR full_name IS NULL OR btrim(full_name) = '' THEN
    RETURN TRUE;
  END IF;

  slug := lower((regexp_match(profile_url, '/in/([^/?#]+)', 'i'))[1]);
  IF slug IS NULL OR slug = '' THEN
    RETURN TRUE;
  END IF;

  profile_name := regexp_replace(slug, '[^a-z0-9]+', ' ', 'g');
  profile_name := regexp_replace(profile_name, '[0-9]+$', '', 'g');
  profile_name := btrim(profile_name);

  name_tokens := regexp_split_to_array(
    lower(regexp_replace(btrim(full_name), '[^a-z0-9]+', ' ', 'g')),
    '\s+'
  );

  IF array_length(name_tokens, 1) IS NULL OR array_length(name_tokens, 1) < 2 THEN
    RETURN FALSE;
  END IF;

  FOREACH token IN ARRAY name_tokens LOOP
    IF length(token) >= 3 AND position(token in profile_name) = 0 THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION guard_proactive_recruiter_linkedin_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.provider, '') = 'proactive-public-web'
     AND COALESCE(NEW.linkedin_profile_url, '') <> ''
     AND COALESCE(NEW.full_name, '') <> ''
     AND NOT recruiter_linkedin_identity_consistent(NEW.linkedin_profile_url, NEW.full_name)
  THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_proactive_recruiter_linkedin_identity ON recruiter_contacts;
CREATE TRIGGER trg_guard_proactive_recruiter_linkedin_identity
BEFORE INSERT OR UPDATE OF full_name, linkedin_profile_url, provider
ON recruiter_contacts
FOR EACH ROW
EXECUTE FUNCTION guard_proactive_recruiter_linkedin_identity();
