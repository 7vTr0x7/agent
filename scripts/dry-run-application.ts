import "dotenv/config";
import { ApplicationAdapterRegistry } from "../src/applications/ApplicationAdapter";
import { createHostedAtsApplicationAdapters } from "../src/applications/AtsApplicationAdapters";
import { ApplicationSubmissionService } from "../src/applications/ApplicationSubmissionService";
import { BrowserSessionService } from "../src/applications/BrowserSession";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { loadConfig } from "../src/config/env";

interface Arguments {
  url: string;
  company: string;
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument '${argument}'. Use --url and --company.`);
    }

    const name = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}.`);
    }

    values.set(name, value);
    index += 1;
  }

  const url = values.get("url");
  const company = values.get("company");
  if (!url || !company) {
    throw new Error("Usage: npm run dry-run -- --url <application-url> --company <company-name>");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("--url must be a valid URL.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("--url must use http or https.");
  }

  return { url, company };
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const config = loadConfig();
  const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
  const candidateProfileId = process.env.CANDIDATE_PROFILE_ID ?? "";
  const candidateProfile = await candidateProfiles.getById(candidateProfileId);

  if (!candidateProfile) {
    throw new Error("Configured candidate profile could not be resolved.");
  }

  const browserSessions = new BrowserSessionService({
    headless: process.env.DRY_RUN_HEADLESS !== "false",
    navigationTimeoutMs: config.ollama.timeoutMs
  });
  const adapters = new ApplicationAdapterRegistry(createHostedAtsApplicationAdapters());
  const applications = {
    beginSubmission: async (): Promise<boolean> => {
      throw new Error("Safety violation: dry-run attempted to reserve a real application submission.");
    },
    cancelSubmission: async (): Promise<void> => undefined,
    markSubmitted: async (): Promise<void> => {
      throw new Error("Safety violation: dry-run attempted to mark an application submitted.");
    }
  };

  const service = new ApplicationSubmissionService(
    browserSessions,
    adapters,
    applications,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    true
  );

  const applicationId = `dry-run-${Date.now()}`;
  const startedAt = new Date().toISOString();
  const outcome = await service.submit({
    context: {
      applicationId,
      candidateProfileId: candidateProfile.id,
      jobOpportunityId: `dry-run-${Date.now()}`,
      url: args.url
    },
    companyName: args.company,
    excludedCompanies: (process.env.JOB_EXCLUDED_COMPANIES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    candidateProfile
  });

  console.log(JSON.stringify({
    dryRun: true,
    startedAt,
    company: args.company,
    requestedUrl: args.url,
    adapter: outcome.adapterName,
    safetyAllowed: outcome.safetyAllowed,
    submitted: outcome.submitted,
    reason: outcome.reason
  }, null, 2));

  if (outcome.submitted) {
    throw new Error("Safety violation: dry-run reported a submitted application.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
