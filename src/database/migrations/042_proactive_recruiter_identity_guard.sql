-- Adversarial runtime guard: public hiring-post discovery must never persist
-- a person recruiter whose parsed title is actually a URL/search-result artifact.
-- The observed production failure was e.g. title = "LinkedIn https://de"
-- with no validated person profile URL. Employer recruiting contacts remain
-- valid and are intentionally exempted.

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
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_proactive_recruiter_identity ON recruiter_contacts;
CREATE TRIGGER trg_guard_proactive_recruiter_identity
BEFORE INSERT OR UPDATE ON recruiter_contacts
FOR EACH ROW
EXECUTE FUNCTION guard_proactive_recruiter_identity();

-- Remove malformed person records already produced by the real runtime.
DELETE FROM recruiter_contacts
WHERE provider = 'proactive-public-web'
  AND linkedin_profile_url IS NULL
  AND COALESCE(full_name, '') <> 'Employer recruiting contact'
  AND (
    COALESCE(title, '') ~* '^\\s*LinkedIn\\s+https?://'
    OR COALESCE(title, '') ~* 'https?://'
  );
