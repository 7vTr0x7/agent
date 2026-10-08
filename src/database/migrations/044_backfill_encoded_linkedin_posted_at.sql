-- Backfill exact LinkedIn publication timestamps from activity/share IDs whose
-- URL separators were percent-encoded by a search provider.
WITH normalized AS (
  SELECT
    id,
    regexp_replace(source_url, '%2D', '-', 'gi') AS url
  FROM public_contact_resources
  WHERE source_type = 'LINKEDIN_POST'
    AND posted_at IS NULL
),
decoded AS (
  SELECT
    id,
    COALESCE(
      substring(url from '(?:activity|share)-([0-9]{15,25})'),
      substring(url from 'urn:li:(?:activity|share):([0-9]{15,25})')
    ) AS activity_id
  FROM normalized
)
UPDATE public_contact_resources p
SET posted_at = to_timestamp((d.activity_id::numeric / 4194304.0) / 1000.0)
FROM decoded d
WHERE p.id = d.id
  AND d.activity_id IS NOT NULL;
