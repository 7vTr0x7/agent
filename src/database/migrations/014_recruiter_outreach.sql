CREATE TABLE IF NOT EXISTS recruiter_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  company_domain VARCHAR(255) NOT NULL,
  email VARCHAR(320) NOT NULL,
  full_name VARCHAR(255),
  title VARCHAR(255),
  department VARCHAR(100),
  seniority VARCHAR(100),
  country VARCHAR(100),
  location VARCHAR(255),
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verification_status VARCHAR(50),
  provider VARCHAR(100) NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_recruiter_contact_email_domain UNIQUE (company_domain, email)
);

CREATE INDEX IF NOT EXISTS idx_recruiter_contacts_company
  ON recruiter_contacts (company_domain, verified DESC, confidence DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS recruiter_contact_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_contact_id UUID NOT NULL REFERENCES recruiter_contacts(id) ON DELETE CASCADE,
  provider VARCHAR(100) NOT NULL,
  source_url TEXT,
  source_type VARCHAR(100),
  confidence INTEGER CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_recruiter_contact_source UNIQUE (recruiter_contact_id, provider, source_url)
);

CREATE TABLE IF NOT EXISTS recruiter_discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name VARCHAR(255) NOT NULL,
  company_domain VARCHAR(255) NOT NULL,
  job_opportunity_id UUID REFERENCES job_opportunities(id) ON DELETE SET NULL,
  candidate_profile_id TEXT,
  provider VARCHAR(100) NOT NULL,
  status VARCHAR(30) NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')),
  contacts_found INTEGER NOT NULL DEFAULT 0 CHECK (contacts_found >= 0),
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recruiter_discovery_company
  ON recruiter_discovery_runs (company_domain, started_at DESC);

CREATE TABLE IF NOT EXISTS recruiter_outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recruiter_contact_id UUID NOT NULL REFERENCES recruiter_contacts(id) ON DELETE CASCADE,
  job_opportunity_id UUID REFERENCES job_opportunities(id) ON DELETE SET NULL,
  application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
  candidate_profile_id TEXT NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'READY'
    CHECK (status IN ('READY', 'ACTIVE', 'PAUSED', 'STOPPED', 'COMPLETED', 'FAILED')),
  stop_reason VARCHAR(255),
  next_action_at TIMESTAMPTZ,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_recruiter_outreach_sequence UNIQUE (recruiter_contact_id, job_opportunity_id, candidate_profile_id)
);

CREATE INDEX IF NOT EXISTS idx_recruiter_outreach_due
  ON recruiter_outreach_sequences (next_action_at)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS recruiter_outreach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES recruiter_outreach_sequences(id) ON DELETE CASCADE,
  message_type VARCHAR(30) NOT NULL CHECK (message_type IN ('INITIAL', 'FOLLOW_UP')),
  sequence_step INTEGER NOT NULL CHECK (sequence_step >= 0),
  recipient_email VARCHAR(320) NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PREPARED'
    CHECK (status IN ('PREPARED', 'SENT', 'FAILED', 'CANCELLED')),
  provider VARCHAR(100),
  provider_message_id VARCHAR(255),
  provider_thread_id VARCHAR(255),
  sent_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_recruiter_outreach_message_step UNIQUE (sequence_id, sequence_step)
);

CREATE INDEX IF NOT EXISTS idx_recruiter_outreach_messages_recipient
  ON recruiter_outreach_messages (recipient_email, created_at DESC);

CREATE TABLE IF NOT EXISTS recruiter_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320),
  company_domain VARCHAR(255),
  reason VARCHAR(100) NOT NULL,
  source VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (email IS NOT NULL OR company_domain IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_recruiter_suppressions_email
  ON recruiter_suppressions (LOWER(email)) WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recruiter_suppressions_domain
  ON recruiter_suppressions (LOWER(company_domain)) WHERE company_domain IS NOT NULL;
