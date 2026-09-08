-- Enforce permanent application deduplication on the modern opportunity identity.
-- NULL values are excluded so any legacy rows without an opportunity remain valid.
CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_job_opportunity_id
  ON applications (job_opportunity_id)
  WHERE job_opportunity_id IS NOT NULL;
