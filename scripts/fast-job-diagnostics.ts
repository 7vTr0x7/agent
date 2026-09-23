import "dotenv/config";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { loadJobSearchPolicy } from "../src/jobs/policy/loadJobSearchPolicy";
import { evaluateJobEligibility } from "../src/jobs/policy/JobEligibility";
import { DeterministicJobMatcher } from "../src/matching/DeterministicJobMatcher";
import { JobOpportunity } from "../src/jobs/domain/JobOpportunity";

interface JobRow {
  id: string;
  company_name: string;
  title: string;
  location: string | null;
  country: string | null;
  workplace_type: JobOpportunity["workplaceType"];
  description: string;
  posted_at: Date | null;
  canonical_url: string;
  sources: string | null;
  task_status: string | null;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const database = new Database(config.databaseUrl);
  try {
    await new MigrationRunner(database).run();
    const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!profile) throw new Error("Configured candidate profile could not be resolved.");

    const policy = loadJobSearchPolicy();
    const matcher = new DeterministicJobMatcher();
    const result = await database.query<JobRow>(`
      SELECT
        j.id, j.company_name, j.title, j.location, j.country, j.workplace_type,
        j.description, j.posted_at, j.canonical_url,
        (
          SELECT string_agg(DISTINCT o.platform, ', ' ORDER BY o.platform)
          FROM job_observations o WHERE o.job_opportunity_id=j.id
        ) AS sources,
        (
          SELECT string_agg(DISTINCT t.status, ', ' ORDER BY t.status)
          FROM tasks t
          WHERE t.task_type='MATCH_JOB'
            AND (t.payload->>'jobOpportunityId') = j.id::text
            AND (t.payload->>'candidateProfileId') = $1::text
        ) AS task_status
      FROM job_opportunities j
      ORDER BY j.posted_at DESC NULLS LAST, j.company_name, j.title
    `, [profile.id]);

    const rows = result.rows.map((row) => {
      const job: JobOpportunity = {
        id: row.id, canonicalId: row.id, canonicalUrl: row.canonical_url,
        title: row.title, companyName: row.company_name, location: row.location,
        country: row.country, workplaceType: row.workplace_type, employmentType: null,
        description: row.description, postedAt: row.posted_at, sourceUpdatedAt: null,
        lastSeenAt: row.posted_at ?? new Date(), closedAt: null, status: "ACTIVE",
        createdAt: row.posted_at ?? new Date(), updatedAt: row.posted_at ?? new Date()
      };
      const eligibility = evaluateJobEligibility(job, policy);
      const match = matcher.evaluate(job, profile);
      return { row, eligibility, match };
    });

    const counts = <T extends string>(values: T[]): Record<string, number> =>
      values.reduce<Record<string, number>>((acc, value) => { acc[value] = (acc[value] ?? 0) + 1; return acc; }, {});

    const dispatched = rows.filter((x) => x.eligibility.decision === "ELIGIBLE");
    const filtered = rows.filter((x) => x.eligibility.decision === "REJECT");
    const taskMissing = dispatched.filter((x) => !x.row.task_status);
    const likelyRelevant = rows.filter((x) =>
      x.match.technicalOrientation === "REACT_WEB" ||
      x.match.technicalOrientation === "FULL_STACK" ||
      x.match.technicalOrientation === "FRONTEND"
    );

    console.log(JSON.stringify({
      status: "ok",
      profile: {
        yearsExperience: profile.yearsExperience,
        skills: profile.skills,
        targetTitles: profile.targetTitles,
        location: profile.location
      },
      totals: {
        persisted: rows.length,
        policyEligible: dispatched.length,
        policyFiltered: filtered.length,
        eligibleWithoutMatchTask: taskMissing.length,
        likelyRelevantByDeterministicClassifier: likelyRelevant.length
      },
      policyRejectionReasons: counts(filtered.map((x) => x.eligibility.reason)),
      orientations: counts(rows.map((x) => x.match.technicalOrientation)),
      geographies: counts(rows.map((x) => x.match.geography)),
      seniority: counts(rows.map((x) => x.match.seniority)),
      freshness: counts(rows.map((x) => x.match.freshness)),
      decisionByAllPersisted: counts(rows.map((x) => x.match.decision)),
      dispatcherGaps: taskMissing.slice(0, 50).map((x) => ({
        company: x.row.company_name, title: x.row.title, location: x.row.location,
        source: x.row.sources, eligibility: x.eligibility, deterministic: {
          decision: x.match.decision, score: x.match.matchScore,
          orientation: x.match.technicalOrientation, geography: x.match.geography,
          seniority: x.match.seniority, reason: x.match.reason
        }, url: x.row.canonical_url
      })),
      topDeterministicCandidates: rows
        .filter((x) => x.match.decision !== "REJECT" && x.eligibility.decision === "ELIGIBLE")
        .sort((a,b) => b.match.matchScore - a.match.matchScore)
        .slice(0, 20)
        .map((x) => ({
          company: x.row.company_name, title: x.row.title, location: x.row.location,
          source: x.row.sources, taskStatus: x.row.task_status,
          decision: x.match.decision, score: x.match.matchScore,
          orientation: x.match.technicalOrientation, geography: x.match.geography,
          seniority: x.match.seniority, reason: x.match.reason, url: x.row.canonical_url
        })),
      representativeRelevantJobs: likelyRelevant.slice(0, 30).map((x) => ({
        company: x.row.company_name, title: x.row.title, location: x.row.location,
        source: x.row.sources, policy: x.eligibility, taskStatus: x.row.task_status,
        decision: x.match.decision, score: x.match.matchScore,
        orientation: x.match.technicalOrientation, geography: x.match.geography,
        seniority: x.match.seniority, url: x.row.canonical_url
      }))
    }, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: "FAILED", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
