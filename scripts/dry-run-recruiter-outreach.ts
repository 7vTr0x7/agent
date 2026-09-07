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

async function main(): Promise<void> {
  const companyName = required("RECRUITER_TEST_COMPANY_NAME");
  const companyDomain = required("RECRUITER_TEST_COMPANY_DOMAIN");
  const jobOpportunityId = required("RECRUITER_TEST_JOB_OPPORTUNITY_ID");
  const applicationId = required("RECRUITER_TEST_APPLICATION_ID");
  const candidateProfileId = required("CANDIDATE_PROFILE_ID");
  const candidateName = process.env.RECRUITER_TEST_CANDIDATE_NAME?.trim() || "Candidate";
  const jobTitle = process.env.RECRUITER_TEST_JOB_TITLE?.trim() || "Frontend Engineer";
  const jobDescription = process.env.RECRUITER_TEST_JOB_DESCRIPTION?.trim() || "Frontend engineering role using React and TypeScript.";
  const location = process.env.RECRUITER_TEST_LOCATION?.trim() || "Bengaluru, India";
  const selectedProvider = providerId();

  const database = new Database(required("DATABASE_URL"));
  try {
    await new MigrationRunner(database).run();
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
      jobOpportunityId,
      applicationId
    }, Number(process.env.RECRUITER_MAX_CONTACTS_PER_APPLICATION ?? 3));

    const preparation = new RecruiterOutreachPreparationService({
      repository,
      minConfidence: Number(process.env.RECRUITER_MIN_CONFIDENCE ?? 80),
      requireVerifiedEmail: true,
      dryRun: true
    });

    const prepared = discovered.status === "DISCOVERED"
      ? await preparation.prepare({ companyName, companyDomain, jobTitle, jobDescription, jobOpportunityId, applicationId, candidateProfileId, candidateName }, discovered.contacts)
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
