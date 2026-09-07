import "dotenv/config";
import { ApplicationAdapterRegistry } from "../src/applications/ApplicationAdapter";
import { createHostedAtsApplicationAdapters } from "../src/applications/AtsApplicationAdapters";
import { ApplicationSubmissionService } from "../src/applications/ApplicationSubmissionService";
import { BrowserSessionService } from "../src/applications/BrowserSession";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";

interface Arguments { url?: string; company?: string; }

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`Unexpected argument '${argument}'. Supported arguments: --url and --company.`);
    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}.`);
    values.set(name, value);
    index += 1;
  }
  const url = values.get("url");
  const company = values.get("company");
  if ((url && !company) || (!url && company)) throw new Error("--url and --company must be supplied together.");
  if (url) {
    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch { throw new Error("--url must be a valid URL."); }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") throw new Error("--url must use http or https.");
  }
  return { url, company };
}

interface DryRunTarget {
  url: string;
  company: string;
  jobTitle: string;
  jobOpportunityId: string;
  rankScore: number | null;
  existingApplication: boolean;
}

async function resolveTarget(database: Database, args: Arguments, candidateProfileId: string): Promise<DryRunTarget> {
  if (args.url && args.company) {
    return {
      url: args.url,
      company: args.company,
      jobTitle: "Manual dry-run target",
      jobOpportunityId: "manual",
      rankScore: null,
      existingApplication: false
    };
  }

  const result = await database.query<{
    job_opportunity_id: string;
    canonical_url: string;
    company_name: string;
    title: string;
    rank_score: number;
    existing_application: boolean;
  }>(
    `SELECT jo.id AS job_opportunity_id,
            jo.canonical_url,
            jo.company_name,
            jo.title,
            jr.rank_score,
            EXISTS (
              SELECT 1
              FROM applications a
              WHERE a.job_opportunity_id = jo.id
                AND a.candidate_profile_id = $1
            ) AS existing_application
     FROM job_opportunities jo
     INNER JOIN match_decisions md
       ON md.job_opportunity_id = jo.id
      AND md.candidate_profile_id = $1
     INNER JOIN job_rankings jr
       ON jr.job_opportunity_id = jo.id
      AND jr.candidate_profile_id = $1
     WHERE md.decision = 'APPLY'
       AND jo.status = 'ACTIVE'
       AND jo.canonical_url IS NOT NULL
       AND jo.canonical_url <> ''
     ORDER BY jr.rank_score DESC, jr.ranked_at DESC, jo.created_at DESC
     LIMIT 1`,
    [candidateProfileId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(
      "No ACTIVE APPLY-ranked opportunity is available for the configured candidate profile. " +
      "Run discovery/matching first or use --url and --company for a manual dry-run target."
    );
  }

  return {
    url: row.canonical_url,
    company: row.company_name,
    jobTitle: row.title,
    jobOpportunityId: row.job_opportunity_id,
    rankScore: row.rank_score,
    existingApplication: row.existing_application
  };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const config = loadConfig();
  const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
  const candidateProfileId = process.env.CANDIDATE_PROFILE_ID ?? "";
  const candidateProfile = await candidateProfiles.getById(candidateProfileId);
  if (!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");

  const database = new Database(config.databaseUrl);
  try {
    await new MigrationRunner(database).run();

    const target = await resolveTarget(database, args, candidateProfile.id);
    const browserSessions = new BrowserSessionService({ headless: process.env.DRY_RUN_HEADLESS !== "false", navigationTimeoutMs: config.ollama.timeoutMs });
    const adapters = new ApplicationAdapterRegistry(createHostedAtsApplicationAdapters());
    const applications = {
      beginSubmission: async (): Promise<boolean> => { throw new Error("Safety violation: dry-run attempted to reserve a real application submission."); },
      cancelSubmission: async (): Promise<void> => undefined,
      markSubmitted: async (): Promise<void> => { throw new Error("Safety violation: dry-run attempted to mark an application submitted."); }
    };
    const service = new ApplicationSubmissionService(browserSessions, adapters, applications, undefined, undefined, undefined, undefined, undefined, undefined, true);
    const applicationId = `dry-run-${Date.now()}`;
    const startedAt = new Date().toISOString();
    const outcome = await service.submit({
      context: { applicationId, candidateProfileId: candidateProfile.id, jobOpportunityId: target.jobOpportunityId === "manual" ? `dry-run-${Date.now()}` : target.jobOpportunityId, url: target.url },
      companyName: target.company,
      excludedCompanies: (process.env.JOB_EXCLUDED_COMPANIES ?? "").split(",").map((value) => value.trim()).filter(Boolean),
      candidateProfile
    });
    console.log(JSON.stringify({
      dryRun: true,
      selectionMode: args.url ? "manual" : "automatic",
      startedAt,
      company: target.company,
      jobTitle: target.jobTitle,
      jobOpportunityId: target.jobOpportunityId,
      rankScore: target.rankScore,
      existingApplication: target.existingApplication,
      requestedUrl: target.url,
      adapter: outcome.adapterName,
      safetyAllowed: outcome.safetyAllowed,
      submitted: outcome.submitted,
      reason: outcome.reason
    }, null, 2));
    if (outcome.submitted) throw new Error("Safety violation: dry-run reported a submitted application.");
  } finally { await database.close(); }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
