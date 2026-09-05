CREATE TABLE IF NOT EXISTS job_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_opportunity_id UUID NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  candidate_profile_id VARCHAR(100) NOT NULL,
  rank_score INTEGER NOT NULL CHECK (rank_score BETWEEN 0 AND 100),
  tier INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 3),
  location_score INTEGER NOT NULL CHECK (location_score BETWEEN 0 AND 100),
  match_score INTEGER NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  freshness_bonus INTEGER NOT NULL CHECK (freshness_bonus BETWEEN 0 AND 10),
  reason TEXT NOT NULL,
  ranked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_job_rankings_opportunity_profile
    UNIQUE (job_opportunity_id, candidate_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_job_rankings_queue
  ON job_rankings (tier ASC, rank_score DESC, ranked_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_rankings_opportunity
  ON job_rankings (job_opportunity_id, ranked_at DESC);
