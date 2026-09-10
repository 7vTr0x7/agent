CREATE OR REPLACE FUNCTION job_agent_proactive_followup_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.message_type = 'FOLLOW_UP'
     AND EXISTS (
       SELECT 1
       FROM recruiter_outreach_sequences s
       WHERE s.id = NEW.sequence_id
         AND s.campaign_type = 'PROACTIVE_RECRUITER'
     ) THEN
    NEW.subject := COALESCE(NULLIF(NEW.subject, ''), 'Following up on my note');
    NEW.body := 'Hi,\n\nI wanted to follow up on my earlier note about exploring Frontend / React / Next.js opportunities. I’m happy to share my resume or additional details if my background is relevant to roles you recruit for.\n\nThank you.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proactive_followup_defaults ON recruiter_outreach_messages;
CREATE TRIGGER trg_proactive_followup_defaults
BEFORE INSERT ON recruiter_outreach_messages
FOR EACH ROW
EXECUTE FUNCTION job_agent_proactive_followup_defaults();
