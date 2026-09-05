CREATE TABLE IF NOT EXISTS tailored_resume_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  job_opportunity_id UUID NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  candidate_profile_id VARCHAR(100) NOT NULL,
  job_title TEXT NOT NULL,
  source_version TEXT NOT NULL,
  resume_path TEXT NOT NULL,
  ats_score INTEGER NOT NULL CHECK (ats_score BETWEEN 0 AND 100),
  matched_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tailored_resume_application UNIQUE (application_id)
);

CREATE INDEX IF NOT EXISTS idx_tailored_resume_job_opportunity
  ON tailored_resume_versions (job_opportunity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tailored_resume_candidate
  ON tailored_resume_versions (candidate_profile_id, created_at DESC);
