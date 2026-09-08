-- Replace the earlier partial opportunity dedup index with a normal unique index.
-- PostgreSQL permits multiple NULL values, so legacy applications without an
-- opportunity remain valid while ON CONFLICT (job_opportunity_id) is inferable.
DROP INDEX IF EXISTS uq_applications_job_opportunity_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_job_opportunity_id
  ON applications (job_opportunity_id);
