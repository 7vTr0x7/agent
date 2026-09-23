CREATE TABLE IF NOT EXISTS public_contact_resource_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL REFERENCES public_contact_resources(id) ON DELETE CASCADE,
  normalized_email TEXT NOT NULL,
  domain TEXT NOT NULL,
  validation_status VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED',
  relevance_score INTEGER NOT NULL DEFAULT 0,
  evidence_context TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (resource_id, normalized_email)
);

CREATE INDEX IF NOT EXISTS idx_public_contact_resource_contacts_email
  ON public_contact_resource_contacts(normalized_email);

CREATE INDEX IF NOT EXISTS idx_public_contact_resource_contacts_relevance
  ON public_contact_resource_contacts(relevance_score DESC);

CREATE INDEX IF NOT EXISTS idx_public_contact_resource_contacts_validation
  ON public_contact_resource_contacts(validation_status);
