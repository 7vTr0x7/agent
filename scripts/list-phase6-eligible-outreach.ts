import "dotenv/config";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { recruiterRealSendEligibilitySql } from "../src/recruiters/RecruiterMailboxVerification";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = new Database(config.databaseUrl);
  try {
    await new MigrationRunner(database).run();
    const eligibility = recruiterRealSendEligibilitySql("c");
    const result = await database.query(`SELECT m.id AS message_id,m.recipient_email,m.subject,m.status,m.send_state,
             s.id AS sequence_id,s.status AS sequence_status,s.job_opportunity_id,s.candidate_profile_id,
             c.id AS recruiter_contact_id,c.full_name,c.title,c.company_name,c.company_domain,c.verified,c.verification_status,c.email_status,c.mailbox_evidence,c.relevance_status,c.suppressed,
             j.title AS job_title,j.canonical_url AS job_url
        FROM recruiter_outreach_messages m
        JOIN recruiter_outreach_sequences s ON s.id=m.sequence_id
        JOIN recruiter_contacts c ON c.id=s.recruiter_contact_id
        JOIN job_opportunities j ON j.id=s.job_opportunity_id
       WHERE m.status='PREPARED'
         AND COALESCE(m.send_state,'READY')='READY'
         AND s.status IN ('READY','ACTIVE')
         AND (${eligibility})
         AND LOWER(m.recipient_email)=LOWER(c.email)
         AND NOT EXISTS (SELECT 1 FROM recruiter_suppressions x WHERE LOWER(COALESCE(x.email,''))=LOWER(m.recipient_email) OR LOWER(COALESCE(x.company_domain,''))=LOWER(c.company_domain))
       ORDER BY c.company_domain,j.posted_at DESC NULLS LAST,m.created_at ASC
       LIMIT 25`);
    console.log(JSON.stringify(result.rows, null, 2));
  } finally { await database.close(); }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
