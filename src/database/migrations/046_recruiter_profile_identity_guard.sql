-- Prevent public-search parsing errors from attaching one person's LinkedIn URL
-- to a different parsed name. If a LinkedIn slug contains meaningful name tokens
-- and none overlap the persisted full name, the identity is not safe to persist.
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
  slug_tokens := regexp_split_to_array(trim(slug), '\s+');
  name_tokens := regexp_split_to_array(trim(normalized_name), '\s+');

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
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_recruiter_profile_identity_consistency ON recruiter_contacts;
CREATE TRIGGER trg_guard_recruiter_profile_identity_consistency
BEFORE INSERT OR UPDATE ON recruiter_contacts
FOR EACH ROW
EXECUTE FUNCTION guard_recruiter_profile_identity_consistency();

-- Repair malformed identities already present in a database created before this guard.
DELETE FROM recruiter_contacts
WHERE provider = 'proactive-public-web'
  AND linkedin_profile_url IS NOT NULL
  AND COALESCE(full_name, '') <> ''
  AND full_name <> 'Employer recruiting contact'
  AND (
    SELECT count(*)
    FROM unnest(
      regexp_split_to_array(
        trim(regexp_replace(lower(split_part(split_part(linkedin_profile_url, '/in/', 2), '?', 1)), '[^a-z0-9]+', ' ', 'g')),
        '\s+'
      )
    ) AS slug_token
    WHERE length(slug_token) >= 4
  ) >= 2
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(
      regexp_split_to_array(
        trim(regexp_replace(lower(split_part(split_part(linkedin_profile_url, '/in/', 2), '?', 1)), '[^a-z0-9]+', ' ', 'g')),
        '\s+'
      )
    ) AS slug_token
    JOIN unnest(
      regexp_split_to_array(
        trim(regexp_replace(lower(full_name), '[^a-z0-9]+', ' ', 'g')),
        '\s+'
      )
    ) AS name_token
      ON length(slug_token) >= 4
     AND slug_token = name_token
  );
