-- A real-data runtime exposed a false proactive recruiter: the persisted person had
-- no email, a placeholder title ("Recruiting professional"), and only low-confidence
-- evidence. A placeholder title must not cross the persistence boundary on weak evidence.
-- Stronger recruiter records can still persist with an explicit title, email, or
-- confidence at/above the normal evidence threshold.

CREATE OR REPLACE FUNCTION guard_proactive_recruiter_low_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.provider = 'proactive-public-web'
     AND COALESCE(NEW.title, '') = 'Recruiting professional'
     AND NEW.email IS NULL
     AND COALESCE(NEW.confidence, 0) < 50
  THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_proactive_recruiter_low_evidence ON recruiter_contacts;
CREATE TRIGGER trg_guard_proactive_recruiter_low_evidence
BEFORE INSERT OR UPDATE ON recruiter_contacts
FOR EACH ROW
EXECUTE FUNCTION guard_proactive_recruiter_low_evidence();

-- Remove the known false-positive shape observed by the real runtime.
DELETE FROM recruiter_contacts
WHERE provider = 'proactive-public-web'
  AND COALESCE(title, '') = 'Recruiting professional'
  AND email IS NULL
  AND COALESCE(confidence, 0) < 50;
