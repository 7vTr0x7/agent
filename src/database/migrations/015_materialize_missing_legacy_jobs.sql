-- Materialize a legacy jobs row for every opportunity that predates or bypassed
-- the legacy jobs ingestion path. Applications still reference jobs.id, while
-- the newer opportunity pipeline is the source of truth for job metadata.
INSERT INTO jobs (
  source,
  source_job_id,
  url,
  title,
  company_name,
  location,
  country,
  workplace_type,
  employment_type,
  description,
  posted_at,
  discovered_at,
  content_hash,
  created_at,
  updated_at,
  job_opportunity_id
)
SELECT
  'opportunity-materialized',
  jo.id::text,
  jo.canonical_url,
  jo.title,
  jo.company_name,
  jo.location,
  jo.country,
  jo.workplace_type,
  jo.employment_type,
  jo.description,
  jo.posted_at,
  jo.last_seen_at,
  encode(digest(jo.canonical_url || ':' || jo.id::text, 'sha256'), 'hex'),
  jo.created_at,
  COALESCE(jo.updated_at, jo.created_at),
  jo.id
FROM job_opportunities jo
WHERE NOT EXISTS (
  SELECT 1
  FROM jobs j
  WHERE j.job_opportunity_id = jo.id
);

-- A URL may already have a legacy job row that was not linked during an
-- earlier migration. Prefer the existing row before relying on synthesized rows.
UPDATE jobs j
SET job_opportunity_id = jo.id
FROM job_opportunities jo
WHERE j.job_opportunity_id IS NULL
  AND regexp_replace(trim(j.url), '[?#].*$', '') = jo.canonical_url;

CREATE INDEX IF NOT EXISTS idx_jobs_job_opportunity_id ON jobs (job_opportunity_id);
