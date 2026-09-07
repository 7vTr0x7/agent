import "dotenv/config";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { createRecruiterDiscoveryProvider } from "../src/recruiters/createRecruiterDiscoveryProvider";
import { PersistentRecruiterDiscoveryService } from "../src/recruiters/PersistentRecruiterDiscoveryService";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { RecruiterOutreachPreparationService } from "../src/recruiters/RecruiterOutreachPreparationService";
import { RecruiterOutreachSendService } from "../src/recruiters/RecruiterOutreachSendService";
import { GmailMailbox } from "../src/email/GmailMailbox";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function providerId(): "hunter" | "snov" | "job-posting" {
  const value = process.env.RECRUITER_TEST_PROVIDER?.trim() || process.env.RECRUITER_DISCOVERY_PROVIDER?.trim() || "job-posting";
  if (value === "hunter" || value === "snov" || value === "job-posting") return value;
  throw new Error("RECRUITER_TEST_PROVIDER must be hunter, snov, or job-posting");
}

const noSendMailbox: GmailMailbox = {
  async listMessages() { return []; },
  async getMessage() { throw new Error("Dry-run mailbox must never fetch Gmail messages."); },
  async sendMessage() { throw new Error("Dry-run attempted to send a recruiter email."); }
};

async function ensureTestFixture(database: Database, companyName: string, companyDomain: string, jobTitle: string, jobDescription: string): Promise<{ jobOpportunityId: string; applicationId: string }> {
  const domain = companyDomain.trim().toLowerCase().replace(/^www\./, "");
  const key = domain.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "company";
  const sourceJobId = `recruiter-dry-run-${key}`;
  const url = `https://example.invalid/recruiter-dry-run/${key}`;
  const contentHash = `recruiter-dry-run-${key}`;
  const canonicalId = `recruiter-dry-run-${key}`;

  const jobResult = await database.query<{ id: string }>(
    `INSERT INTO jobs (source, source_job_id, url, title, company_name, location, description, content_hash)
     VALUES ('recruiter-dry-run', $1, $2, $3, $4, 'Bengaluru, India', $5, $6)
     ON CONFLICT (source, source_job_id) DO UPDATE SET title=EXCLUDED.title, company_name=EXCLUDED.company_name, description=EXCLUDED.description, updated_at=NOW()
     RETURNING id`,
    [sourceJobId, url, jobTitle, companyName, jobDescription, contentHash]
  );
  const jobId = jobResult.rows[0]?.id;
  if (!jobId) throw new Error("Could not create recruiter dry-run job fixture.");

  const opportunityResult = await database.query<{ id: string }>(
    `INSERT INTO job_opportunities (canonical_id, canonical_url, title, company_name, location, country, workplace_type, description, status)
     VALUES ($1, $2, $3, $4, 'Bengaluru, India', 'India', 'hybrid', $5, 'ACTIVE')
     ON CONFLICT (canonical_id) DO UPDATE SET title=EXCLUDED.title, company_name=EXCLUDED.company_name, location=EXCLUDED.location, description=EXCLUDED.description, status='ACTIVE', last_seen_at=NOW(), updated_at=NOW()
     RETURNING id`,
    [canonicalId, url, jobTitle, companyName, jobDescription]
  );
  const jobOpportunityId = opportunityResult.rows[0]?.id;
  if (!jobOpportunityId) throw new Error("Could not create recruiter dry-run opportunity fixture.");

  await database.query(
    `UPDATE jobs SET job_opportunity_id=$2, updated_at=NOW() WHERE id=$1`,
    [jobId, jobOpportunityId]
  );

  const applicationResult = await database.query<{ id: string }>(
    `INSERT INTO applications (job_id, job_opportunity_id, status)
     VALUES ($1, $2, 'MATCHED')
     ON CONFLICT (job_id) DO UPDATE SET job_opportunity_id=EXCLUDED.job_opportunity_id, updated_at=NOW()
     RETURNING id`,
    [jobId, jobOpportunityId]
  );
  const applicationId = applicationResult.rows[0]?.id;
  if (!applicationId) throw new Error("Could not create recruiter dry-run application fixture.");

  return { jobOpportunityId, applicationId };
}

async function main(): Promise<void> {
  const companyName = process.env.RECRUITER_TEST_COMPANY_NAME?.trim() || "some-company";
  const companyDomain = process.env.RECRUITER_TEST_COMPANY_DOMAIN?.trim() || "company.com";
  const candidateProfileId = process.env.CANDIDATE_PROFILE_ID?.trim() || "dry-run-candidate";
  const candidateName = process.env.RECRUITER_TEST_CANDIDATE_NAME?.trim() || "Candidate";
  const jobTitle = process.env.RECRUITER_TEST_JOB_TITLE?.trim() || "Frontend Engineer";
  const jobDescription = process.env.RECRUITER_TEST_JOB_DESCRIPTION?.trim() || "Frontend engineering role using React and TypeScript.";
  const location = process.env.RECRUITER_TEST_LOCATION?.trim() || "Bengaluru, India";
  const selectedProvider = providerId();

  const database = new Database(required("DATABASE_URL"));
  try {
    await new MigrationRunner(database).run();
    const fixture = await ensureTestFixture(database, companyName, companyDomain, jobTitle, jobDescription);
    const repository = new RecruiterDiscoveryRepository(database);
    const provider = createRecruiterDiscoveryProvider({
      provider: selectedProvider,
      hunterApiKey: process.env.HUNTER_API_KEY?.trim() || null,
      snovClientId: process.env.SNOV_CLIENT_ID?.trim() || null,
      snovClientSecret: process.env.SNOV_CLIENT_SECRET?.trim() || null
    });

    const discovery = new PersistentRecruiterDiscoveryService({
      provider,
      repository,
      minConfidence: Number(process.env.RECRUITER_MIN_CONFIDENCE ?? 80),
      requireVerifiedEmail: true
    });

    const discovered = await discovery.discoverAndPersist({
      companyName,
      companyDomain,
      jobTitle,
      jobDescription,
      location,
      candidateProfileId,
      jobOpportunityId: fixture.jobOpportunityId,
      applicationId: fixture.applicationId
    }, Number(process.env.RECRUITER_MAX_CONTACTS_PER_APPLICATION ?? 3));

    const preparation = new RecruiterOutreachPreparationService({
      repository,
      minConfidence: Number(process.env.RECRUITER_MIN_CONFIDENCE ?? 80),
      requireVerifiedEmail: true,
      dryRun: true
    });

    const prepared = discovered.status === "DISCOVERED"
      ? await preparation.prepare({ companyName, companyDomain, jobTitle, jobDescription, jobOpportunityId: fixture.jobOpportunityId, applicationId: fixture.applicationId, candidateProfileId, candidateName }, discovered.contacts)
      : [];

    const sendService = new RecruiterOutreachSendService({
      repository,
      mailbox: noSendMailbox,
      dryRun: true,
      outboundEnabled: false
    });

    const sendResults = [];
    for (const item of prepared) {
      sendResults.push(await sendService.send(item.message, companyDomain));
    }

    console.log(JSON.stringify({
      dryRun: true,
      provider: selectedProvider,
      companyName,
      companyDomain,
      jobTitle,
      location,
      stages: {
        discovery: discovered.status,
        discoveredContacts: discovered.contacts.length,
        preparedMessages: prepared.length,
        sendResults: sendResults.map((result) => result.status)
      },
      contacts: discovered.contacts.map((contact) => ({
        email: contact.email,
        fullName: contact.fullName,
        title: contact.title,
        confidence: contact.confidence,
        verified: contact.verified,
        verificationStatus: contact.verificationStatus
      })),
      safety: {
        gmailCalled: false,
        realEmailSent: false,
        dryRunEnforced: true
      }
    }, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
