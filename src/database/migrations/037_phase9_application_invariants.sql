ALTER TABLE application_attempts
  ADD COLUMN IF NOT EXISTS failure_code VARCHAR(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'application_attempts_failure_code_check'
  ) THEN
    ALTER TABLE application_attempts
      ADD CONSTRAINT application_attempts_failure_code_check CHECK (
        failure_code IS NULL OR failure_code IN (
          'UNSUPPORTED_PLATFORM',
          'INVALID_APPLICATION_URL',
          'AUTH_REQUIRED',
          'CAPTCHA_REQUIRED',
          'BOT_CHALLENGE',
          'MISSING_REQUIRED_DATA',
          'UNSUPPORTED_FIELD',
          'INVALID_ATTACHMENT',
          'DUPLICATE_APPLICATION',
          'EXCLUDED_EMPLOYER',
          'TIMEOUT',
          'NETWORK_ERROR',
          'PROVIDER_ERROR',
          'SUBMISSION_AMBIGUOUS',
          'VALIDATION_FAILED',
          'MANUAL_REVIEW',
          'PROMPT_INJECTION'
        )
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION validate_application_phase9_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  latest_attempt RECORD;
  employer_name TEXT;
BEGIN
  SELECT j.company_name INTO employer_name
  FROM jobs j
  WHERE j.id = NEW.job_id;

  IF LOWER(TRIM(COALESCE(employer_name, ''))) IN ('octopus technologies', 'sketch brahma technologies')
     AND NEW.status IN ('READY', 'QUEUED', 'CLAIMED', 'FORM_DISCOVERED', 'FILLING', 'VALIDATING', 'READY_TO_SUBMIT', 'SUBMISSION_IN_PROGRESS', 'SUBMISSION_UNKNOWN', 'SENT') THEN
    RAISE EXCEPTION 'Application for permanently excluded employer cannot enter active application state: %', employer_name;
  END IF;

  IF NEW.status = 'SENT' THEN
    SELECT outcome, confirmation_url, external_application_id
      INTO latest_attempt
    FROM application_attempts
    WHERE application_id = NEW.id
    ORDER BY attempted_at DESC, id DESC
    LIMIT 1;

    IF latest_attempt.outcome IS DISTINCT FROM 'CONFIRMED_SUCCESS'
       OR (NULLIF(TRIM(COALESCE(latest_attempt.confirmation_url, '')), '') IS NULL
           AND NULLIF(TRIM(COALESCE(latest_attempt.external_application_id, '')), '') IS NULL) THEN
      RAISE EXCEPTION 'Application cannot enter SENT without confirmed submission outcome and independent evidence';
    END IF;
  END IF;

  IF OLD.status = 'SUBMISSION_UNKNOWN' AND NEW.status = 'SENT' THEN
    IF latest_attempt.outcome IS DISTINCT FROM 'CONFIRMED_SUCCESS' THEN
      RAISE EXCEPTION 'Ambiguous application cannot become SENT without reconciliation evidence';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_application_phase9_state ON applications;
CREATE CONSTRAINT TRIGGER trg_application_phase9_state
AFTER INSERT OR UPDATE OF status ON applications
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_application_phase9_state();

CREATE INDEX IF NOT EXISTS idx_application_attempts_failure_code
  ON application_attempts (failure_code)
  WHERE failure_code IS NOT NULL;
