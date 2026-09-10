ALTER TABLE recruiter_outreach_sequences
  ADD COLUMN IF NOT EXISTS campaign_type VARCHAR(40) NOT NULL DEFAULT 'JOB_RECRUITER',
  ADD COLUMN IF NOT EXISTS target_roles JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE recruiter_outreach_sequences
  ALTER COLUMN job_opportunity_id DROP NOT NULL;

ALTER TABLE recruiter_outreach_sequences
  DROP CONSTRAINT IF EXISTS recruiter_outreach_sequences_campaign_type_check;

ALTER TABLE recruiter_outreach_sequences
  ADD CONSTRAINT recruiter_outreach_sequences_campaign_type_check
  CHECK (campaign_type IN ('JOB_RECRUITER','PROACTIVE_RECRUITER'));

CREATE INDEX IF NOT EXISTS idx_recruiter_outreach_campaign
  ON recruiter_outreach_sequences (candidate_profile_id, campaign_type, status, next_action_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_proactive_recruiter_sequence
  ON recruiter_outreach_sequences (recruiter_contact_id, candidate_profile_id, campaign_type)
  WHERE campaign_type = 'PROACTIVE_RECRUITER';

CREATE TABLE IF NOT EXISTS recruiter_proactive_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_contact_id UUID NOT NULL REFERENCES recruiter_contacts(id) ON DELETE CASCADE,
  candidate_profile_id TEXT NOT NULL,
  target_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  role_match_score INTEGER NOT NULL CHECK (role_match_score BETWEEN 0 AND 100),
  hiring_evidence_score INTEGER NOT NULL CHECK (hiring_evidence_score BETWEEN 0 AND 100),
  overall_confidence INTEGER NOT NULL CHECK (overall_confidence BETWEEN 0 AND 100),
  evidence_type VARCHAR(40) NOT NULL,
  evidence_freshness VARCHAR(20) NOT NULL,
  evidence_date TIMESTAMPTZ,
  discovery_source VARCHAR(100) NOT NULL,
  discovery_url TEXT NOT NULL,
  discovery_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT recruiter_proactive_evidence_freshness_check CHECK (evidence_freshness IN ('current','recent','historical','unknown'))
);

CREATE INDEX IF NOT EXISTS idx_recruiter_proactive_evidence_rank
  ON recruiter_proactive_evidence (candidate_profile_id, role_match_score DESC, hiring_evidence_score DESC, overall_confidence DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_recruiter_proactive_evidence_source
  ON recruiter_proactive_evidence (recruiter_contact_id, candidate_profile_id, discovery_url);
