CREATE TABLE IF NOT EXISTS runtime_safety_controls (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  kill_switch_active BOOLEAN NOT NULL DEFAULT TRUE,
  reason TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT runtime_safety_controls_singleton CHECK (id = TRUE)
);

INSERT INTO runtime_safety_controls (id, kill_switch_active, reason)
VALUES (TRUE, TRUE, 'Phase 10 activation safety defaults to emergency-stop until explicitly cleared.')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_runtime_safety_controls_kill_switch
  ON runtime_safety_controls (kill_switch_active);

CREATE UNIQUE INDEX IF NOT EXISTS uq_proactive_recruiter_sequence_identity
  ON recruiter_outreach_sequences (candidate_profile_id, recruiter_contact_id, campaign_type)
  WHERE campaign_type = 'PROACTIVE_RECRUITER';

ALTER TABLE recruiter_outreach_sequences
  ADD CONSTRAINT recruiter_campaign_job_shape_check
  CHECK (
    (campaign_type = 'PROACTIVE_RECRUITER' AND job_opportunity_id IS NULL)
    OR
    (campaign_type <> 'PROACTIVE_RECRUITER' AND job_opportunity_id IS NOT NULL)
  );
