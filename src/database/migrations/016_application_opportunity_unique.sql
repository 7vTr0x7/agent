-- Enforce permanent application deduplication on the modern opportunity identity.
-- A normal UNIQUE index is intentionally used so PostgreSQL can infer it from
-- ON CONFLICT (job_opportunity_id). PostgreSQL already permits multiple NULLs,
-- so legacy applications without an opportunity remain valid.
CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_job_opportunity_id
  ON applications (job_opportunity_id);
