import "dotenv/config";

interface Check {
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  message: string;
}

const DEFAULT_JOB_SOURCE_COUNT = 13;

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

function add(checks: Check[], name: string, status: Check["status"], message: string): void {
  checks.push({ name, status, message });
}

function configuredSourceCount(raw: string | undefined): number | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

function main(): void {
  const checks: Check[] = [];
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const candidateProfileId = process.env.CANDIDATE_PROFILE_ID?.trim();
  const configuredJobSources = process.env.JOB_SOURCES?.trim();
  const parsedSourceCount = configuredSourceCount(configuredJobSources);
  const discoveryEnabled = bool("JOB_DISCOVERY_ENABLED", true);
  const automationEnabled = bool("AUTOMATION_ENABLED", false);
  const applicationDryRun = bool("APPLICATION_DRY_RUN", true);
  const outboundEnabled = bool("OUTBOUND_ENABLED", false);
  const gmailEnabled = bool("GMAIL_ENABLED", false);
  const gmailReady = Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN && process.env.GMAIL_USER_EMAIL);
  const tailoringEnabled = bool("RESUME_TAILORING_ENABLED", false);
  const masterResume = process.env.RESUME_MASTER_PATH?.trim();
  const genericAdapterEnabled = bool("GENERIC_APPLICATION_ADAPTER_ENABLED", true);
  const recruiterEnabled = bool("RECRUITER_OUTREACH_ENABLED", false);
  const recruiterDryRun = bool("RECRUITER_OUTREACH_DRY_RUN", true);
  const recruiterActivation = process.env.RECRUITER_OUTREACH_ACTIVATION ?? "disabled";
  const recruiterLiveConfirmed = bool("RECRUITER_LIVE_ACTIVATION_CONFIRMED", false);

  add(checks, "database", databaseUrl ? "PASS" : "FAIL", databaseUrl ? "DATABASE_URL is configured." : "DATABASE_URL is missing.");
  add(checks, "candidate-profile", candidateProfileId ? "PASS" : "FAIL", candidateProfileId ? "CANDIDATE_PROFILE_ID is configured." : "CANDIDATE_PROFILE_ID is missing.");

  if (!discoveryEnabled) add(checks, "job-discovery", "WARN", "Job discovery is disabled.");
  else if (configuredJobSources === undefined || configuredJobSources === "") add(checks, "job-discovery", "PASS", `${DEFAULT_JOB_SOURCE_COUNT} built-in job sources will be used.`);
  else if (parsedSourceCount === null) add(checks, "job-discovery", "FAIL", "JOB_SOURCES is present but is not valid JSON array configuration.");
  else if (parsedSourceCount === 0) add(checks, "job-discovery", "WARN", "JOB_SOURCES is an empty array; no discovery sources will run.");
  else add(checks, "job-discovery", "PASS", `${parsedSourceCount} job source(s) configured through JOB_SOURCES.`);

  if (!automationEnabled) add(checks, "automation", "WARN", "AUTOMATION_ENABLED=false; autonomous application processing is disabled.");
  else if (applicationDryRun) add(checks, "application-safety", "WARN", "Automation is enabled but APPLICATION_DRY_RUN=true; applications will not be submitted for real.");
  else if (!outboundEnabled) add(checks, "application-safety", "FAIL", "Automation is enabled with real submission requested, but OUTBOUND_ENABLED=false.");
  else add(checks, "application-safety", "PASS", "Real application submission is enabled by configuration.");

  if (gmailEnabled && !gmailReady) add(checks, "gmail", "FAIL", "GMAIL_ENABLED=true but Gmail OAuth/user configuration is incomplete.");
  else if (gmailEnabled) add(checks, "gmail", "PASS", "Gmail configuration is present.");
  else add(checks, "gmail", "WARN", "Gmail integration is disabled.");

  if (tailoringEnabled && !masterResume) add(checks, "resume-tailoring", "FAIL", "RESUME_TAILORING_ENABLED=true but RESUME_MASTER_PATH is missing.");
  else if (tailoringEnabled) add(checks, "resume-tailoring", "PASS", "Resume tailoring is configured.");
  else add(checks, "resume-tailoring", "WARN", "Resume tailoring is disabled.");

  if (genericAdapterEnabled) add(checks, "generic-application-adapter", "WARN", "Generic application adapter is enabled; it is the fallback for supported ATS pages without a dedicated adapter.");
  else add(checks, "generic-application-adapter", "WARN", "Generic application adapter is disabled; some unsupported hosted ATS pages may not be applicable automatically.");

  if (recruiterActivation === "live" && !recruiterLiveConfirmed) add(checks, "recruiter-activation", "FAIL", "Recruiter activation is set to live without RECRUITER_LIVE_ACTIVATION_CONFIRMED=true.");
  else if (recruiterEnabled && !recruiterDryRun) add(checks, "recruiter-outreach", "WARN", `Recruiter outreach is configured for non-dry-run operation (${recruiterActivation}); run npm run preflight:recruiter-outreach before enabling delivery.`);
  else add(checks, "recruiter-outreach", "PASS", "Recruiter outreach remains safely disabled/dry-run by default.");

  const failures = checks.filter((check) => check.status === "FAIL").length;
  const warnings = checks.filter((check) => check.status === "WARN").length;
  const status = failures > 0 ? "NOT_READY" : warnings > 0 ? "READY_WITH_WARNINGS" : "READY";

  console.log(JSON.stringify({ status, failures, warnings, checks, next: failures > 0 ? "Fix FAIL checks before starting autonomous operation." : "Configuration is structurally ready; run the appropriate dry-runs/preflights before enabling live outbound actions." }, null, 2));
  if (failures > 0) process.exitCode = 1;
}

main();
