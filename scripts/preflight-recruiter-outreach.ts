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
      gmailAccountTier: config.gmail.accountTier,
      gmailDailySendLimit: config.gmail.dailySendLimit,
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

  if (!config.recruiterOutreach.dryRun && config.recruiterOutreach.requireVerifiedEmail !== true) {
    fail("real recruiter outreach requires RECRUITER_REQUIRE_VERIFIED_EMAIL=true.");
  }

  if (!config.recruiterOutreach.dryRun && config.recruiterOutreach.minConfidence < 80) {
    fail("real recruiter outreach requires RECRUITER_MIN_CONFIDENCE>=80.");
  }

  if (!config.recruiterOutreach.dryRun && config.recruiterOutreach.maxContactsPerApplication > 3) {
    fail("real recruiter outreach allows at most 3 contacts per application.");
  }

  if (config.recruiterOutreach.maxMessagesPerDay > config.gmail.dailySendLimit) {
    fail(`RECRUITER_MAX_MESSAGES_PER_DAY=${config.recruiterOutreach.maxMessagesPerDay} exceeds the configured Gmail ${config.gmail.accountTier} daily limit of ${config.gmail.dailySendLimit}.`);
  }

  if (config.recruiterOutreach.maxMessagesPerHour > config.recruiterOutreach.maxMessagesPerDay) {
    fail("RECRUITER_MAX_MESSAGES_PER_HOUR cannot exceed the daily recruiter send limit.");
  }

  if (!config.recruiterOutreach.dryRun && config.recruiterOutreach.maxMessagesPerHour < Math.ceil(config.recruiterOutreach.maxMessagesPerDay / 24)) {
    checks.push("hourly recruiter limit is below the daily/24 pacing required to reach the configured daily ceiling; this is allowed but will reduce throughput.");
  }

  if (config.recruiterOutreach.requireVerifiedEmail && config.recruiterOutreach.discoveryProvider === "job-posting") {
    checks.push("job-posting contacts remain blocked from sending until a verification provider confirms deliverability.");
  }

  if (config.recruiterOutreach.maxContactsPerApplication > 3) {
    checks.push("max contacts per application is above the conservative default of 3; review before activation.");
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
    gmailAccountTier: config.gmail.accountTier,
    gmailDailySendLimit: config.gmail.dailySendLimit,
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
