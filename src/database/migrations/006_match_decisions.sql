CREATE TABLE IF NOT EXISTS match_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_opportunity_id UUID NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  candidate_profile_id VARCHAR(100) NOT NULL,
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPLY', 'REJECT', 'REVIEW')),
  match_score INTEGER NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  matched_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT NOT NULL,
  evaluator VARCHAR(50) NOT NULL,
  model VARCHAR(100),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  input_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_match_decisions_opportunity_profile UNIQUE (job_opportunity_id, candidate_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_match_decisions_decision_score
  ON match_decisions (decision, match_score DESC);

CREATE INDEX IF NOT EXISTS idx_match_decisions_opportunity
  ON match_decisions (job_opportunity_id, evaluated_at DESC);
