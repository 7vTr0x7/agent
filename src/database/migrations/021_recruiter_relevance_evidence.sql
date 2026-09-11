ALTER TABLE recruiter_contacts
  ADD COLUMN IF NOT EXISTS relevance_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (relevance_status IN ('CURRENT', 'RECENT', 'HISTORICAL', 'UNKNOWN')),
  ADD COLUMN IF NOT EXISTS relevance_score INTEGER
    CHECK (relevance_score IS NULL OR (relevance_score >= 0 AND relevance_score <= 100)),
  ADD COLUMN IF NOT EXISTS relevance_evidence JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_recruiter_contacts_relevance
  ON recruiter_contacts (company_domain, relevance_status, confidence DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS recruiter_contact_job_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_contact_id UUID NOT NULL REFERENCES recruiter_contacts(id) ON DELETE CASCADE,
  job_opportunity_id UUID NOT NULL REFERENCES job_opportunities(id) ON DELETE CASCADE,
  relevance_status VARCHAR(20) NOT NULL
    CHECK (relevance_status IN ('CURRENT', 'RECENT', 'HISTORICAL', 'UNKNOWN')),
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_recruiter_contact_job_evidence UNIQUE (recruiter_contact_id, job_opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_recruiter_contact_job_evidence_job
  ON recruiter_contact_job_evidence (job_opportunity_id, relevance_status, observed_at DESC);

CREATE OR REPLACE FUNCTION classify_recruiter_contact_relevance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE recruiter_contacts AS c
  SET relevance_status = CASE
        WHEN EXISTS (
          SELECT 1 FROM recruiter_contact_sources s
          WHERE s.recruiter_contact_id = c.id
            AND LOWER(COALESCE(s.source_type, '')) IN ('job_posting', 'current_job_posting', 'current_role')
        ) THEN 'CURRENT'
        WHEN EXISTS (
          SELECT 1 FROM recruiter_contact_sources s
          WHERE s.recruiter_contact_id = c.id
            AND LOWER(COALESCE(s.source_type, '')) IN ('recent_job_posting', 'recent_role')
        ) THEN 'RECENT'
        WHEN EXISTS (
          SELECT 1 FROM recruiter_contact_sources s
          WHERE s.recruiter_contact_id = c.id
            AND LOWER(COALESCE(s.source_type, '')) IN ('historical_job_posting', 'historical_role')
        ) THEN 'HISTORICAL'
        ELSE 'UNKNOWN'
      END,
      relevance_score = CASE
        WHEN EXISTS (
          SELECT 1 FROM recruiter_contact_sources s
          WHERE s.recruiter_contact_id = c.id
            AND LOWER(COALESCE(s.source_type, '')) IN ('job_posting', 'current_job_posting', 'current_role')
        ) THEN 100
        WHEN EXISTS (
          SELECT 1 FROM recruiter_contact_sources s
          WHERE s.recruiter_contact_id = c.id
            AND LOWER(COALESCE(s.source_type, '')) IN ('recent_job_posting', 'recent_role')
        ) THEN 80
        WHEN EXISTS (
          SELECT 1 FROM recruiter_contact_sources s
          WHERE s.recruiter_contact_id = c.id
            AND LOWER(COALESCE(s.source_type, '')) IN ('historical_job_posting', 'historical_role')
        ) THEN 40
        ELSE 0
      END,
      relevance_evidence = COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'provider', s.provider,
          'sourceUrl', s.source_url,
          'sourceType', s.source_type,
          'confidence', s.confidence,
          'observedAt', s.observed_at
        ) ORDER BY s.observed_at DESC)
        FROM recruiter_contact_sources s
        WHERE s.recruiter_contact_id = c.id
      ), '[]'::jsonb),
      updated_at = NOW()
  WHERE c.id = NEW.recruiter_contact_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_classify_recruiter_contact_relevance ON recruiter_contact_sources;
CREATE TRIGGER trg_classify_recruiter_contact_relevance
AFTER INSERT OR UPDATE ON recruiter_contact_sources
FOR EACH ROW
EXECUTE FUNCTION classify_recruiter_contact_relevance();

CREATE OR REPLACE FUNCTION associate_job_posting_recruiters()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'SUCCEEDED' AND NEW.job_opportunity_id IS NOT NULL THEN
    INSERT INTO recruiter_contact_job_evidence (
      recruiter_contact_id, job_opportunity_id, relevance_status, confidence, evidence, observed_at
    )
    SELECT DISTINCT
      c.id,
      NEW.job_opportunity_id,
      c.relevance_status,
      c.confidence,
      c.relevance_evidence,
      NOW()
    FROM recruiter_contacts c
    JOIN recruiter_contact_sources s ON s.recruiter_contact_id = c.id
    WHERE LOWER(c.company_domain) = LOWER(NEW.company_domain)
      AND LOWER(COALESCE(s.source_type, '')) IN ('job_posting', 'current_job_posting', 'current_role', 'recent_job_posting', 'recent_role', 'historical_job_posting', 'historical_role')
      AND s.observed_at >= NEW.started_at
      AND s.observed_at <= COALESCE(NEW.completed_at, NOW())
    ON CONFLICT (recruiter_contact_id, job_opportunity_id)
    DO UPDATE SET
      relevance_status = EXCLUDED.relevance_status,
      confidence = CASE
        WHEN recruiter_contact_job_evidence.confidence IS NULL THEN EXCLUDED.confidence
        WHEN EXCLUDED.confidence IS NULL THEN recruiter_contact_job_evidence.confidence
        ELSE GREATEST(recruiter_contact_job_evidence.confidence, EXCLUDED.confidence)
      END,
      evidence = EXCLUDED.evidence,
      observed_at = EXCLUDED.observed_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_associate_job_posting_recruiters ON recruiter_discovery_runs;
CREATE TRIGGER trg_associate_job_posting_recruiters
AFTER UPDATE OF status ON recruiter_discovery_runs
FOR EACH ROW
EXECUTE FUNCTION associate_job_posting_recruiters();
