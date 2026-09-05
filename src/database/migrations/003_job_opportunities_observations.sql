CREATE TABLE IF NOT EXISTS job_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id VARCHAR(64) NOT NULL UNIQUE,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  location TEXT,
  country TEXT,
  workplace_type TEXT CHECK (workplace_type IS NULL OR workplace_type IN ('onsite', 'remote', 'hybrid')),
  employment_type VARCHAR(50),
  description TEXT NOT NULL,
  posted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'STALE', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_opportunities_company_name ON job_opportunities (company_name);
CREATE INDEX IF NOT EXISTS idx_job_opportunities_status ON job_opportunities (status);
CREATE INDEX IF NOT EXISTS idx_job_opportunities_last_seen_at ON job_opportunities (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS job_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_opportunity_id UUID NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  platform VARCHAR(100) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  source_job_id VARCHAR(255),
  source_url TEXT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload JSONB NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  source_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_job_observations_source_job UNIQUE (platform, source_job_id),
  CONSTRAINT uq_job_observations_content_hash UNIQUE (platform, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_job_observations_opportunity ON job_observations (job_opportunity_id);
CREATE INDEX IF NOT EXISTS idx_job_observations_observed_at ON job_observations (observed_at DESC);

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS job_opportunity_id UUID REFERENCES job_opportunities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_job_opportunity_id ON jobs (job_opportunity_id);

ALTER TABLE job_matches
  ADD COLUMN IF NOT EXISTS job_opportunity_id UUID REFERENCES job_opportunities(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_job_matches_job_opportunity_id ON job_matches (job_opportunity_id);

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS job_opportunity_id UUID REFERENCES job_opportunities(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_applications_job_opportunity_id ON applications (job_opportunity_id);

WITH ranked_jobs AS (
  SELECT j.*, ROW_NUMBER() OVER (
    PARTITION BY regexp_replace(trim(j.url), '[?#].*$', '')
    ORDER BY j.discovered_at ASC, j.id ASC
  ) AS row_number
  FROM jobs j
),
inserted_opportunities AS (
  INSERT INTO job_opportunities (
    canonical_id, canonical_url, title, company_name, location, country,
    workplace_type, employment_type, description, posted_at, updated_at,
    last_seen_at, created_at, updated_at
  )
  SELECT
    encode(digest(regexp_replace(trim(url), '[?#].*$', ''), 'sha256'), 'hex'),
    regexp_replace(trim(url), '[?#].*$', ''),
    title, company_name, location, country, workplace_type, employment_type,
    description, posted_at, updated_at, discovered_at, created_at, updated_at
  FROM ranked_jobs
  WHERE row_number = 1
  ON CONFLICT (canonical_id) DO NOTHING
  RETURNING id
)
UPDATE jobs j
SET job_opportunity_id = o.id
FROM job_opportunities o
WHERE o.canonical_url = regexp_replace(trim(j.url), '[?#].*$', '')
  AND j.job_opportunity_id IS NULL;

INSERT INTO job_observations (
  job_opportunity_id, platform, source_type, source_job_id, source_url,
  discovered_at, observed_at, raw_payload, content_hash
)
SELECT
  j.job_opportunity_id,
  j.source,
  'legacy_jobs',
  j.source_job_id,
  j.url,
  j.discovered_at,
  COALESCE(j.updated_at, j.discovered_at),
  jsonb_build_object(
    'legacyJobId', j.id,
    'source', j.source,
    'sourceJobId', j.source_job_id,
    'url', j.url,
    'title', j.title,
    'companyName', j.company_name,
    'location', j.location,
    'country', j.country,
    'workplaceType', j.workplace_type,
    'employmentType', j.employment_type,
    'description', j.description,
    'postedAt', j.posted_at,
    'updatedAt', j.updated_at
  ),
  j.content_hash
FROM jobs j
WHERE j.job_opportunity_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE job_matches jm
SET job_opportunity_id = j.job_opportunity_id
FROM jobs j
WHERE jm.job_id = j.id AND jm.job_opportunity_id IS NULL;

UPDATE applications a
SET job_opportunity_id = j.job_opportunity_id
FROM jobs j
WHERE a.job_id = j.id AND a.job_opportunity_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_job_opportunity_id
  ON applications (job_opportunity_id)
  WHERE job_opportunity_id IS NOT NULL;
