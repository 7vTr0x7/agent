import "dotenv/config";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { RecruiterDiscoveryTaskDispatcher } from "../src/recruiters/RecruiterDiscoveryTask";
import { resolveEmployerDomainFromJobData } from "../src/recruiters/RecruiterCompanyDomainResolver";
import { PERMANENTLY_EXCLUDED_COMPANIES } from "../src/applications/ApplicationPolicy";
import { TaskQueue } from "../src/queue/TaskQueue";

interface JobRow {
  id: string;
  company_name: string;
  company_domain: string | null;
  canonical_url: string;
  title: string;
  description: string;
  location: string | null;
}

function excluded(companyName: string): boolean {
  const normalized = companyName.trim().toLowerCase();
  return PERMANENTLY_EXCLUDED_COMPANIES.some((company) => company.trim().toLowerCase() === normalized);
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.recruiterOutreach.enabled) {
    throw new Error("Recruiter outreach is disabled in the current environment.");
  }

  const database = new Database(config.databaseUrl);
  try {
    await new MigrationRunner(database).run();

    const profiles = ConfiguredCandidateProfileResolver.fromEnvironment();
    const candidateProfileId = process.env.CANDIDATE_PROFILE_ID ?? "";
    const candidateProfile = await profiles.getById(candidateProfileId);
    if (!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");

    const requestedLimit = Number.parseInt(process.env.RECRUITER_REQUEUE_LIMIT ?? "500", 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 500;

    const result = await database.query<JobRow>(
      `SELECT id, company_name, company_domain, canonical_url, title, description, location
       FROM job_opportunities
       WHERE status = 'ACTIVE'
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit]
    );

    const queue = new TaskQueue(database);
    const dispatcher = new RecruiterDiscoveryTaskDispatcher(queue);
    let queued = 0;
    let skippedExcluded = 0;
    let skippedNoDomain = 0;

    for (const job of result.rows) {
      if (excluded(job.company_name)) {
        skippedExcluded += 1;
        continue;
      }

      const companyDomain = resolveEmployerDomainFromJobData(
        job.company_domain,
        job.canonical_url,
        job.description
      );
      if (!companyDomain) {
        skippedNoDomain += 1;
        continue;
      }

      await dispatcher.enqueue({
        companyName: job.company_name,
        companyDomain,
        jobTitle: job.title,
        jobDescription: job.description,
        location: job.location ?? undefined,
        candidateProfileId,
        candidateName: candidateProfile.fullName ?? ([candidateProfile.firstName, candidateProfile.lastName].filter(Boolean).join(" ") || "Candidate"),
        jobOpportunityId: job.id,
        applicationOutcome: "NOT_ATTEMPTED"
      }, 40);
      queued += 1;
    }

    console.log(JSON.stringify({
      status: "QUEUED",
      inspected: result.rows.length,
      queued,
      skippedExcluded,
      skippedNoDomain,
      dedupeVersion: "v2"
    }, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
