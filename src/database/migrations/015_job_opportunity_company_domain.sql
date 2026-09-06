ALTER TABLE job_opportunities
  ADD COLUMN IF NOT EXISTS company_domain TEXT;

CREATE INDEX IF NOT EXISTS idx_job_opportunities_company_domain
  ON job_opportunities (company_domain)
  WHERE company_domain IS NOT NULL;
