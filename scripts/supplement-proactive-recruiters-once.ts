import { Database } from "../src/database/Database";
import { PersistentRecruiterDiscoveryService } from "../src/recruiters/PersistentRecruiterDiscoveryService";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { RecruiterIdentityRepository } from "../src/recruiters/RecruiterIdentityRepository";
import { JobPostingRecruiterDiscoveryProvider } from "../src/recruiters/JobPostingRecruiterDiscoveryProvider";

async function main(): Promise<void> {
  const database = new Database(process.env.DATABASE_URL ?? "");
  try {
    const candidateProfileId = process.env.CANDIDATE_PROFILE_ID ?? "";
    if (!candidateProfileId) throw new Error("CANDIDATE_PROFILE_ID is required.");

    const jobs = await database.query<{
      job_id: string;
      company_name: string;
      company_domain: string;
      title: string;
      description: string;
      location: string | null;
      canonical_url: string;
    }>(
      `SELECT DISTINCT ON (j.company_domain)
          j.id AS job_id,
          j.company_name,
          j.company_domain,
          j.title,
          j.description,
          j.location,
          j.canonical_url
       FROM job_opportunities j
       WHERE NULLIF(TRIM(j.company_domain), '') IS NOT NULL
         AND LOWER(j.title) ~ '(react|frontend|front-end|next[.]?js|typescript|javascript|full.?stack|software engineer|web developer)'
       ORDER BY j.company_domain, j.posted_at DESC NULLS LAST, j.created_at DESC
       LIMIT 1`
    );

    const discovery = new PersistentRecruiterDiscoveryService({
      provider: new JobPostingRecruiterDiscoveryProvider(),
      repository: new RecruiterDiscoveryRepository(database),
      identityRepository: new RecruiterIdentityRepository(database),
      cooldownHours: 12,
      minConfidence: 80,
      requireVerifiedEmail: false
    });

    const results: Array<Record<string, unknown>> = [];
    for (const job of jobs.rows) {
      try {
        const result = await discovery.discoverAndPersist({
          companyName: job.company_name,
          companyDomain: job.company_domain,
          jobTitle: job.title,
          jobDescription: job.description,
          location: job.location ?? undefined,
          candidateProfileId,
          jobOpportunityId: job.job_id
        }, 5);
        results.push({
          company: job.company_name,
          domain: job.company_domain,
          role: job.title,
          status: result.status,
          reason: result.reason,
          contactsPersisted: result.contacts.length,
          metrics: result.metrics
        });
      } catch (error) {
        results.push({
          company: job.company_name,
          domain: job.company_domain,
          role: job.title,
          status: "FAILED",
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const persisted = await database.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM recruiter_contacts WHERE relevance_status IN ('CURRENT','RECENT')`
    );
    console.log(JSON.stringify({
      status: "ok",
      feature: "PROACTIVE_RECRUITER_EMPLOYER_SUPPLEMENT",
      independentOfMatchDecisions: true,
      employersExamined: jobs.rows.length,
      recruitersPersisted: Number(persisted.rows[0]?.count ?? 0),
      results,
      outreachSent: 0,
      applicationsSent: 0
    }, null, 2));
  } finally {
    await database.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "FAILED", feature: "PROACTIVE_RECRUITER_EMPLOYER_SUPPLEMENT", error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  });
}
