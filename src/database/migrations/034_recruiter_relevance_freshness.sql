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
            AND s.observed_at >= NOW() - INTERVAL '30 days'
        ) THEN 'CURRENT'
        WHEN EXISTS (
          SELECT 1 FROM recruiter_contact_sources s
          WHERE s.recruiter_contact_id = c.id
            AND LOWER(COALESCE(s.source_type, '')) IN ('recent_job_posting', 'recent_role')
            AND s.observed_at >= NOW() - INTERVAL '90 days'
        ) THEN 'RECENT'
        WHEN EXISTS (
          SELECT 1 FROM recruiter_contact_sources s
          WHERE s.recruiter_contact_id = c.id
            AND LOWER(COALESCE(s.source_type, '')) IN ('job_posting', 'current_job_posting', 'current_role', 'recent_job_posting', 'recent_role', 'historical_job_posting', 'historical_role')
            AND s.observed_at <= NOW()
        ) THEN 'HISTORICAL'
        ELSE 'UNKNOWN'
      END,
      relevance_score = CASE
        WHEN EXISTS (
          SELECT 1 FROM recruiter_contact_sources s
          WHERE s.recruiter_contact_id = c.id
            AND LOWER(COALESCE(s.source_type, '')) IN ('job_posting', 'current_job_posting', 'current_role')
            AND s.observed_at >= NOW() - INTERVAL '30 days'
        ) THEN 100
        WHEN EXISTS (
          SELECT 1 FROM recruiter_contact_sources s
          WHERE s.recruiter_contact_id = c.id
            AND LOWER(COALESCE(s.source_type, '')) IN ('recent_job_posting', 'recent_role')
            AND s.observed_at >= NOW() - INTERVAL '90 days'
        ) THEN 80
        WHEN EXISTS (
          SELECT 1 FROM recruiter_contact_sources s
          WHERE s.recruiter_contact_id = c.id
            AND LOWER(COALESCE(s.source_type, '')) IN ('job_posting', 'current_job_posting', 'current_role', 'recent_job_posting', 'recent_role', 'historical_job_posting', 'historical_role')
            AND s.observed_at <= NOW()
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

UPDATE recruiter_contacts AS c
SET relevance_status = CASE
      WHEN EXISTS (SELECT 1 FROM recruiter_contact_sources s WHERE s.recruiter_contact_id=c.id AND LOWER(COALESCE(s.source_type,'')) IN ('job_posting','current_job_posting','current_role') AND s.observed_at >= NOW()-INTERVAL '30 days') THEN 'CURRENT'
      WHEN EXISTS (SELECT 1 FROM recruiter_contact_sources s WHERE s.recruiter_contact_id=c.id AND LOWER(COALESCE(s.source_type,'')) IN ('recent_job_posting','recent_role') AND s.observed_at >= NOW()-INTERVAL '90 days') THEN 'RECENT'
      WHEN EXISTS (SELECT 1 FROM recruiter_contact_sources s WHERE s.recruiter_contact_id=c.id AND s.observed_at <= NOW()) THEN 'HISTORICAL'
      ELSE 'UNKNOWN'
    END,
    relevance_score = CASE
      WHEN EXISTS (SELECT 1 FROM recruiter_contact_sources s WHERE s.recruiter_contact_id=c.id AND LOWER(COALESCE(s.source_type,'')) IN ('job_posting','current_job_posting','current_role') AND s.observed_at >= NOW()-INTERVAL '30 days') THEN 100
      WHEN EXISTS (SELECT 1 FROM recruiter_contact_sources s WHERE s.recruiter_contact_id=c.id AND LOWER(COALESCE(s.source_type,'')) IN ('recent_job_posting','recent_role') AND s.observed_at >= NOW()-INTERVAL '90 days') THEN 80
      WHEN EXISTS (SELECT 1 FROM recruiter_contact_sources s WHERE s.recruiter_contact_id=c.id AND s.observed_at <= NOW()) THEN 40
      ELSE 0
    END,
    updated_at=NOW();
