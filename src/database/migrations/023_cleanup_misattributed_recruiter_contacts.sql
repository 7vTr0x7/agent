-- Remove recruiter contacts created from the previously broken employer-domain
-- attribution path. These records attached third-party domains to aggregator
-- company names and must never be eligible for outreach.
DELETE FROM recruiter_contacts
WHERE (LOWER(company_name) = 'we work remotely'
       AND LOWER(company_domain) IN ('fastly.com', 'legion.co', 'porkbun.com', 'launchdarkly.com'))
   OR (LOWER(company_name) = 'pplwise' AND LOWER(company_domain) IN ('arbeitnow.com', 'arbeitnow.fr'))
   OR (LOWER(company_name) = 'almetra' AND LOWER(company_domain) IN ('arbeitnow.com', 'arbeitnow.fr'))
   OR (LOWER(company_name) = 'unitarian universalist association' AND LOWER(company_domain) = 'himalayas.app');
