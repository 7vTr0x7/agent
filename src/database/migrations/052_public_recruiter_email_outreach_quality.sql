-- Public recruiter emails are distinct from mailbox-verified emails.
-- A public company-domain address backed by current/recent hiring evidence is
-- useful for outreach even when no mailbox-level verification provider exists.
-- This does NOT set verified=true and does NOT claim mailbox verification.

CREATE OR REPLACE FUNCTION job_agent_public_email_address_quality(email_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(email_value,'') ~* '^[A-Za-z0-9!#$&''*+/=?^_`{|}~.-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$'
     AND split_part(COALESCE(email_value,''),'@',1) !~* '(^\\.|\\.$|\\.\\.|%)';
$$;

CREATE OR REPLACE FUNCTION job_agent_non_recruiting_mailbox(email_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(split_part(COALESCE(email_value,''),'@',1)) IN ('sales','support','customer-support','customersupport','help','helpdesk','billing','accounts','finance','press','media','legal','privacy','marketing','partnerships','partnership','procurement','info','hello','contact','admin','webmaster','postmaster','noreply','no-reply');
$$;

CREATE OR REPLACE FUNCTION normalize_public_recruiter_email_quality()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  email_domain TEXT;
  company_domain TEXT;
BEGIN
  IF COALESCE(NEW.provider,'') <> 'proactive-public-web' OR NULLIF(BTRIM(NEW.email),'') IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.email := lower(btrim(NEW.email));
  email_domain := lower(split_part(NEW.email,'@',2));
  company_domain := lower(regexp_replace(btrim(COALESCE(NEW.company_domain,'')),'^www\\.','','i'));

  IF NOT job_agent_public_email_address_quality(NEW.email) THEN
    NEW.email := NULL;
    NEW.email_status := 'UNVERIFIED';
    NEW.verification_status := 'public-web-unverified';
    NEW.mx_status := 'UNKNOWN';
    NEW.mailbox_evidence := FALSE;
    NEW.verification_evidence := '[]'::jsonb;
    NEW.email_discovery_status := 'PENDING';
    RETURN NEW;
  END IF;

  IF company_domain <> ''
     AND email_domain = company_domain
     AND NOT job_agent_non_recruiting_mailbox(NEW.email)
     AND UPPER(COALESCE(NEW.relevance_status,'UNKNOWN')) IN ('CURRENT','RECENT')
     AND UPPER(COALESCE(NEW.email_status,'UNVERIFIED')) IN ('UNVERIFIED','LIKELY')
     AND COALESCE(NEW.verified,FALSE)=FALSE
     AND COALESCE(NEW.mailbox_evidence,FALSE)=FALSE THEN
    NEW.email_status := 'LIKELY';
    NEW.verification_status := 'public-web-likely';
    NEW.mx_status := CASE WHEN COALESCE(NEW.mx_status,'UNKNOWN')='EXISTS' THEN NEW.mx_status ELSE 'UNKNOWN' END;
    NEW.verification_evidence := jsonb_build_array(jsonb_build_object('provider','public-web','status','public-web-likely','mailboxLevel',false,'source','public-hiring-evidence'));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recruiter_contacts_public_email_quality_trigger ON recruiter_contacts;
CREATE TRIGGER recruiter_contacts_public_email_quality_trigger
BEFORE INSERT OR UPDATE OF provider,email,company_domain,relevance_status,email_status,verification_evidence,verified,mailbox_evidence
ON recruiter_contacts
FOR EACH ROW
EXECUTE FUNCTION normalize_public_recruiter_email_quality();

UPDATE recruiter_contacts
SET email = NULL, email_status = 'UNVERIFIED', verification_status = 'public-web-unverified', mx_status = 'UNKNOWN', mailbox_evidence = FALSE, verification_evidence = '[]'::jsonb, email_discovery_status = 'PENDING', updated_at = NOW()
WHERE provider='proactive-public-web' AND email IS NOT NULL AND NOT job_agent_public_email_address_quality(email);

UPDATE recruiter_contacts
SET email_status = 'UNVERIFIED', verification_status = 'public-web-unverified', mailbox_evidence = FALSE, verified = FALSE, verification_evidence = '[]'::jsonb, updated_at = NOW()
WHERE provider='proactive-public-web' AND email IS NOT NULL AND job_agent_non_recruiting_mailbox(email);

UPDATE recruiter_contacts
SET email_status = 'LIKELY', verification_status = 'public-web-likely', mailbox_evidence = FALSE, verified = FALSE,
    verification_evidence = jsonb_build_array(jsonb_build_object('provider','public-web','status','public-web-likely','mailboxLevel',false,'source','public-hiring-evidence')),
    updated_at = NOW()
WHERE provider='proactive-public-web'
  AND email IS NOT NULL
  AND job_agent_public_email_address_quality(email)
  AND NOT job_agent_non_recruiting_mailbox(email)
  AND lower(split_part(email,'@',2)) = lower(company_domain)
  AND UPPER(COALESCE(relevance_status,'UNKNOWN')) IN ('CURRENT','RECENT')
  AND COALESCE(verified,FALSE)=FALSE
  AND COALESCE(mailbox_evidence,FALSE)=FALSE
  AND UPPER(COALESCE(email_status,'UNVERIFIED')) IN ('UNVERIFIED','LIKELY');
