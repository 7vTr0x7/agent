import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { JobPostingRecruiterDiscoveryProvider } from "../src/recruiters/JobPostingRecruiterDiscoveryProvider";
import { PersistentRecruiterDiscoveryService } from "../src/recruiters/PersistentRecruiterDiscoveryService";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { RecruiterIdentityRepository } from "../src/recruiters/RecruiterIdentityRepository";

async function main(): Promise<void> {
  const config = loadConfig();
  const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
  if (!profile) throw new Error("Configured candidate profile could not be resolved.");
  const database = new Database(config.databaseUrl);
  try {
    const jobs = (await database.query<{
      job_id: string;
      company_name: string;
      company_domain: string;
      title: string;
      description: string;
      location: string | null;
      canonical_url: string;
    }>(
      `SELECT DISTINCT ON (j.company_domain)
              j.id AS job_id, j.company_name, j.company_domain, j.title,
              j.description, j.location, j.canonical_url
         FROM job_opportunities j
        WHERE NULLIF(TRIM(j.company_domain), '') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM recruiter_discovery_runs r
             WHERE LOWER(r.company_domain)=LOWER(j.company_domain)
               AND r.provider='public-web'
               AND r.status='SUCCEEDED'
               AND r.started_at >= NOW()-INTERVAL '12 hours'
          )
        ORDER BY j.company_domain, j.posted_at DESC NULLS LAST, j.created_at DESC
        LIMIT 2`
    )).rows;

    const discovery = new PersistentRecruiterDiscoveryService({
      provider: new JobPostingRecruiterDiscoveryProvider(),
      repository: new RecruiterDiscoveryRepository(database),
      identityRepository: new RecruiterIdentityRepository(database),
      cooldownHours: 12,
      minConfidence: 80,
      requireVerifiedEmail: false
    });

    const results: Array<Record<string, unknown>> = [];
    for (const job of jobs) {
      try {
        const result = await discovery.discoverAndPersist({
          companyName: job.company_name,
          companyDomain: job.company_domain,
          jobTitle: job.title,
          jobDescription: job.description,
          location: job.location ?? undefined,
          candidateProfileId: profile.id,
          jobOpportunityId: job.job_id
        }, 3);
        results.push({
          jobId: job.job_id,
          company: job.company_name,
          companyDomain: job.company_domain,
          title: job.title,
          status: result.status,
          reason: result.reason,
          contacts: result.contacts.length,
          metrics: result.metrics
        });
      } catch (error) {
        results.push({
          jobId: job.job_id,
          company: job.company_name,
          companyDomain: job.company_domain,
          title: job.title,
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
      feature: "JOB_LINKED_RECRUITER_FALLBACK",
      candidatesConsidered: jobs.length,
      results,
      persistedRecruiters: Number(persisted.rows[0]?.count ?? 0),
      sendEnabled: false,
      gmailEnabled: false,
      outboundEnabled: false
    }, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAILED", feature: "JOB_LINKED_RECRUITER_FALLBACK", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
