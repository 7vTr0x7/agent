import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config/env";

interface Check {
  name: string;
  status: "PASS" | "FAIL";
  message: string;
}

function fail(message: string): never {
  throw new Error(`Autonomous runtime preflight failed: ${message}`);
}

function checkResumeAvailability(configuredPath: string | null): string {
  const candidates = [
    configuredPath?.trim() || "",
    path.resolve("./resumes"),
    path.resolve("./data/resumes")
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && candidate.toLowerCase().endsWith(".pdf") && stat.size > 0) return candidate;
      if (stat.isDirectory()) {
        const pdf = fs.readdirSync(candidate, { withFileTypes: true })
          .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
          .map((entry) => path.join(candidate, entry.name))
          .sort()[0];
        if (pdf) return pdf;
      }
    } catch {
      // Try the next supported location.
    }
  }

  return "";
}

function main(): void {
  const config = loadConfig();
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, message: string): void => {
    checks.push({ name, status: ok ? "PASS" : "FAIL", message });
  };

  add("automation", config.automationEnabled, "AUTOMATION_ENABLED=true is required for autonomous processing.");
  add("application-live", !config.applicationDryRun, "APPLICATION_DRY_RUN=false is required for real applications.");
  add("outbound", config.outboundEnabled, "OUTBOUND_ENABLED=true is required for live outbound actions.");
  add("job-discovery", config.discoveryEnabled, "JOB_DISCOVERY_ENABLED=true is required for continuous discovery.");
  add("application-daily-limit", config.applicationRateLimitPerDay === 200, `Application global daily limit is ${config.applicationRateLimitPerDay}; expected 200.`);
  add("application-company-limit", config.applicationCompanyRateLimitPerDay === 20, `Application per-company daily limit is ${config.applicationCompanyRateLimitPerDay}; expected 20.`);
  add("gmail", config.gmail.enabled && Boolean(config.gmail.clientId && config.gmail.clientSecret && config.gmail.refreshToken && config.gmail.userEmail), "Gmail OAuth configuration must be complete for recruiter email delivery.");
  add("recruiter-enabled", config.recruiterOutreach.enabled, "RECRUITER_OUTREACH_ENABLED=true is required for recruiter outreach.");
  add("recruiter-live", !config.recruiterOutreach.dryRun && config.recruiterOutreach.activation === "live" && config.recruiterOutreach.liveActivationConfirmed, "Recruiter outreach must be live, non-dry-run, and explicitly confirmed.");
  add("recruiter-daily-limit", config.recruiterOutreach.maxMessagesPerDay === 200, `Recruiter daily limit is ${config.recruiterOutreach.maxMessagesPerDay}; expected 200.`);
  add("recruiter-hourly-limit", config.recruiterOutreach.maxMessagesPerHour === 9, `Recruiter hourly limit is ${config.recruiterOutreach.maxMessagesPerHour}; expected 9.`);
  add("recruiter-verification", config.recruiterOutreach.requireVerifiedEmail && config.recruiterOutreach.minConfidence >= 80, "Recruiter sending requires verified email and confidence >= 80.");
  add("recruiter-contact-cap", config.recruiterOutreach.maxContactsPerApplication <= 3, `Recruiter contacts per application is ${config.recruiterOutreach.maxContactsPerApplication}; maximum is 3.`);
  add("recruiter-followups", config.recruiterOutreach.followUpEnabled && config.recruiterOutreach.followUpDayOffsets.length > 0, "Recruiter follow-ups must have at least one configured offset.");
  add("resume", Boolean(checkResumeAvailability(config.gmail.enabled ? process.env.CANDIDATE_RESUME_PATH ?? null : process.env.CANDIDATE_RESUME_PATH ?? null)), "A non-empty PDF resume must be available for initial recruiter outreach attachments.");

  const failures = checks.filter((check) => check.status === "FAIL");
  const result = {
    status: failures.length === 0 ? "PASS" : "NOT_READY",
    failures: failures.length,
    checks,
    runtime: {
      continuous: true,
      applicationDailyLimit: config.applicationRateLimitPerDay,
      applicationCompanyDailyLimit: config.applicationCompanyRateLimitPerDay,
      recruiterDailyLimit: config.recruiterOutreach.maxMessagesPerDay,
      recruiterHourlyLimit: config.recruiterOutreach.maxMessagesPerHour,
      discoveryIntervalMs: config.discoveryIntervalMs,
      applicationQueueIntervalMs: config.applicationQueueIntervalMs,
      followUpIntervalMs: config.followUpIntervalMs,
      staleSubmissionCheckIntervalMs: config.staleSubmissionCheckIntervalMs
    }
  };

  console.log(JSON.stringify(result, null, 2));
  if (failures.length > 0) fail(failures.map((check) => `${check.name}: ${check.message}`).join(" | "));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
