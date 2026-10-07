-- Backfill exact LinkedIn publication timestamps from activity IDs already stored in canonical URLs.
-- LinkedIn activity IDs encode the creation timestamp in their high bits.
UPDATE public_contact_resources
SET posted_at = to_timestamp(
  (substring(source_url from '(?:activity-|urn:li:activity:)([0-9]{15,25})')::numeric / 4194304.0) / 1000.0
)
WHERE source_type = 'LINKEDIN_POST'
  AND source_url ~ '(?:activity-|urn:li:activity:)[0-9]{15,25}'
  AND posted_at IS DISTINCT FROM to_timestamp(
    (substring(source_url from '(?:activity-|urn:li:activity:)([0-9]{15,25})')::numeric / 4194304.0) / 1000.0
  );
