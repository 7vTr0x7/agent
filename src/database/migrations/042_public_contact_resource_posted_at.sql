ALTER TABLE public_contact_resources
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_public_contact_resources_posted_at
  ON public_contact_resources(posted_at DESC);
