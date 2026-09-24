-- A proactive recruiter is only useful when the hiring evidence is relevant to
-- the candidate's target roles. The real runtime exposed a recruiter whose
-- current hiring evidence was for recruiting/TA roles while targetRoles=[];
-- that must not be surfaced as a relevant hiring lead.

CREATE OR REPLACE FUNCTION guard_proactive_recruiter_target_role_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM recruiter_contacts c
     WHERE c.id = NEW.recruiter_contact_id
       AND c.provider = 'proactive-public-web'
       AND COALESCE(c.full_name, '') <> 'Employer recruiting contact'
       AND jsonb_typeof(COALESCE(NEW.target_roles, '[]'::jsonb)) = 'array'
       AND jsonb_array_length(COALESCE(NEW.target_roles, '[]'::jsonb)) = 0
  ) THEN
    DELETE FROM recruiter_contacts WHERE id = NEW.recruiter_contact_id;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_proactive_recruiter_target_role_evidence ON recruiter_proactive_evidence;
CREATE TRIGGER trg_guard_proactive_recruiter_target_role_evidence
AFTER INSERT OR UPDATE ON recruiter_proactive_evidence
FOR EACH ROW
EXECUTE FUNCTION guard_proactive_recruiter_target_role_evidence();

-- Remove the known real-runtime false positive that had current recruiter
-- evidence but no target-role evidence.
DELETE FROM recruiter_contacts
WHERE provider = 'proactive-public-web'
  AND COALESCE(full_name, '') <> 'Employer recruiting contact'
  AND COALESCE(jsonb_typeof(relevance_evidence->'targetRoles'), 'null') = 'array'
  AND jsonb_array_length(COALESCE(relevance_evidence->'targetRoles', '[]'::jsonb)) = 0;
