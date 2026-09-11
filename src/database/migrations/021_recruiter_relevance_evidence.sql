ALTER TABLE recruiter_contacts
  ADD COLUMN IF NOT EXISTS relevance_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (relevance_status IN ('CURRENT', 'RECENT', 'HISTORICAL', 'UNKNOWN')),
  ADD COLUMN IF NOT EXISTS relevance_score INTEGER
    CHECK (relevance_score IS NULL OR (relevance_score >= 0 AND relevance_score <= 100)),
  ADD COLUMN IF NOT EXISTS relevance_evidence JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_recruiter_contacts_relevance
  ON recruiter_contacts (company_domain, relevance_status, confidence DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS recruiter_contact_job_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_contact_id UUID NOT NULL REFERENCES recruiter_contacts(id) ON DELETE CASCADE,
  job_opportunity_id UUID NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  relevance_status VARCHAR(20) NOT NULL
    CHECK (relevance_status IN ('CURRENT', 'RECENT', 'HISTORICAL', 'UNKNOWN')),
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_recruiter_contact_job_evidence UNIQUE (recruiter_contact_id, job_opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_recruiter_contact_job_evidence_job
  ON recruiter_contact_job_evidence (job_opportunity_id, relevance_status, observed_at DESC);
