import "dotenv/config";
import { loadConfig } from "../src/config/env";

function fail(message: string): never {
  throw new Error(`Recruiter outreach preflight failed: ${message}`);
}

function main(): void {
  const config = loadConfig();
  const checks: string[] = [];

  if (!config.recruiterOutreach.enabled) {
    console.log(JSON.stringify({
      status: "SAFE",
      enabled: false,
      dryRun: config.recruiterOutreach.dryRun,
      outboundEnabled: config.outboundEnabled,
      provider: config.recruiterOutreach.discoveryProvider,
      checks: ["Recruiter outreach is disabled; no recruiter email can be sent."]
    }, null, 2));
    return;
  }

  if (!config.recruiterOutreach.dryRun && !config.outboundEnabled) {
    fail("RECRUITER_OUTREACH_DRY_RUN=false requires OUTBOUND_ENABLED=true.");
  }

  if (!config.recruiterOutreach.dryRun && !config.gmail.enabled) {
    fail("real recruiter outreach requires GMAIL_ENABLED=true.");
  }

  if (!config.recruiterOutreach.dryRun && config.recruiterOutreach.discoveryProvider === "job-posting") {
    fail("job-posting is discovery-only and cannot provide verified recruiter contacts for real sending.");
  }

  if (config.recruiterOutreach.requireVerifiedEmail && config.recruiterOutreach.discoveryProvider === "job-posting") {
    checks.push("job-posting contacts remain blocked from sending until a verification provider confirms deliverability.");
  }

  if (config.recruiterOutreach.maxContactsPerApplication > 3) {
    checks.push("max contacts per application is above the conservative default of 3; review before activation.");
  }

  if (config.recruiterOutreach.maxMessagesPerHour > 15) {
    checks.push("hourly recruiter send limit is above the conservative default of 15; review before activation.");
  }

  if (config.recruiterOutreach.maxMessagesPerDay > 100) {
    checks.push("daily recruiter send limit is above the conservative preflight threshold of 100; review before activation.");
  }

  if (config.recruiterOutreach.followUpEnabled && config.recruiterOutreach.followUpDayOffsets.length === 0) {
    fail("follow-ups are enabled but no follow-up offsets are configured.");
  }

  console.log(JSON.stringify({
    status: "PASS",
    enabled: true,
    dryRun: config.recruiterOutreach.dryRun,
    outboundEnabled: config.outboundEnabled,
    gmailEnabled: config.gmail.enabled,
    provider: config.recruiterOutreach.discoveryProvider,
    requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail,
    minConfidence: config.recruiterOutreach.minConfidence,
    maxContactsPerApplication: config.recruiterOutreach.maxContactsPerApplication,
    maxMessagesPerHour: config.recruiterOutreach.maxMessagesPerHour,
    maxMessagesPerDay: config.recruiterOutreach.maxMessagesPerDay,
    followUpEnabled: config.recruiterOutreach.followUpEnabled,
    checks
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
