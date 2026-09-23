CREATE TABLE IF NOT EXISTS public_hiring_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_url TEXT NOT NULL UNIQUE,
  source VARCHAR(100) NOT NULL,
  title TEXT NOT NULL,
  employer TEXT,
  employer_domain TEXT,
  role TEXT NOT NULL,
  role_match_score INTEGER NOT NULL DEFAULT 0,
  hiring_evidence_score INTEGER NOT NULL DEFAULT 0,
  evidence_freshness VARCHAR(20) NOT NULL DEFAULT 'unknown',
  discovery_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
);

CREATE INDEX IF NOT EXISTS idx_public_hiring_resources_employer_domain ON public_hiring_resources(employer_domain);
CREATE INDEX IF NOT EXISTS idx_public_hiring_resources_role_score ON public_hiring_resources(role_match_score DESC);
CREATE INDEX IF NOT EXISTS idx_public_hiring_resources_last_seen ON public_hiring_resources(last_seen_at DESC);
