-- Phase 8 campaign invariants: proactive outreach is job-independent; job-linked
-- outreach must point at a real persisted opportunity. Cross-path recruiter contact
-- is serialized so JOB_RECRUITER and PROACTIVE_RECRUITER cannot race into duplicate
-- unsolicited outreach for the same recruiter/candidate pair.
ALTER TABLE recruiter_outreach_sequences
  DROP CONSTRAINT IF EXISTS recruiter_outreach_sequences_campaign_job_consistency_check;

ALTER TABLE recruiter_outreach_sequences
  ADD CONSTRAINT recruiter_outreach_sequences_campaign_job_consistency_check
  CHECK (
    (campaign_type = 'PROACTIVE_RECRUITER' AND job_opportunity_id IS NULL AND application_id IS NULL)
    OR
    (campaign_type = 'JOB_RECRUITER' AND job_opportunity_id IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION job_agent_recruiter_cross_path_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('job-agent:recruiter-cross-path:' || NEW.recruiter_contact_id::text || ':' || NEW.candidate_profile_id)
  );

  IF NEW.campaign_type = 'PROACTIVE_RECRUITER' THEN
    IF EXISTS (
      SELECT 1
      FROM recruiter_outreach_sequences s
      WHERE s.recruiter_contact_id = NEW.recruiter_contact_id
        AND s.candidate_profile_id = NEW.candidate_profile_id
        AND s.campaign_type = 'JOB_RECRUITER'
        AND s.status <> 'FAILED'
    ) THEN
      RAISE EXCEPTION 'Recruiter cross-path duplicate: job-linked outreach already exists for this recruiter/candidate';
    END IF;
  ELSIF NEW.campaign_type = 'JOB_RECRUITER' THEN
    IF EXISTS (
      SELECT 1
      FROM recruiter_outreach_sequences s
      WHERE s.recruiter_contact_id = NEW.recruiter_contact_id
        AND s.candidate_profile_id = NEW.candidate_profile_id
        AND s.campaign_type = 'PROACTIVE_RECRUITER'
        AND s.status <> 'FAILED'
    ) THEN
      RAISE EXCEPTION 'Recruiter cross-path duplicate: proactive outreach already exists for this recruiter/candidate';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recruiter_cross_path_guard ON recruiter_outreach_sequences;
CREATE TRIGGER trg_recruiter_cross_path_guard
BEFORE INSERT ON recruiter_outreach_sequences
FOR EACH ROW
EXECUTE FUNCTION job_agent_recruiter_cross_path_guard();

CREATE INDEX IF NOT EXISTS idx_recruiter_outreach_cross_path_guard
  ON recruiter_outreach_sequences (recruiter_contact_id, candidate_profile_id, campaign_type, status);
