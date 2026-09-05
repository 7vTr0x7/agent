CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source VARCHAR(100) NOT NULL,
  source_job_id VARCHAR(255),
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  location TEXT,
  employment_type VARCHAR(50),
  description TEXT NOT NULL,
  posted_at TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_hash VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_jobs_source_job_id UNIQUE (source, source_job_id),
  CONSTRAINT uq_jobs_content_hash UNIQUE (content_hash)
);

CREATE INDEX IF NOT EXISTS idx_jobs_company_name
  ON jobs (company_name);

CREATE INDEX IF NOT EXISTS idx_jobs_discovered_at
  ON jobs (discovered_at DESC);

CREATE TABLE IF NOT EXISTS job_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  match_score INTEGER NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPLY', 'REJECT', 'REVIEW')),
  reason TEXT NOT NULL,
  model VARCHAR(100),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_job_matches_job_id UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS idx_job_matches_decision
  ON job_matches (decision);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  name TEXT,
  email TEXT NOT NULL,
  role TEXT,
  source TEXT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_contacts_email UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_contacts_company_name
  ON contacts (company_name);

CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DISCOVERED'
    CHECK (
      status IN (
        'DISCOVERED',
        'MATCHED',
        'READY',
        'DRAFTED',
        'SENT',
        'FOLLOW_UP_DUE',
        'RESPONDED',
        'REJECTED',
        'WITHDRAWN',
        'CLOSED'
      )
    ),
  email_thread_id TEXT,
  applied_at TIMESTAMPTZ,
  last_follow_up_at TIMESTAMPTZ,
  next_follow_up_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_applications_job_id UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS idx_applications_status
  ON applications (status);

CREATE INDEX IF NOT EXISTS idx_applications_next_follow_up
  ON applications (next_follow_up_at);

CREATE TABLE IF NOT EXISTS application_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_events_application_id
  ON application_events (application_id, created_at DESC);
