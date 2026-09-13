import "dotenv/config";

import fs from "node:fs";
import { Database } from "../src/database/Database";

interface ReadinessCheck { name: string; status: "NOT_CONFIGURED" | "CONFIGURED" | "READY" | "ARMED" | "LIVE" | "BLOCKED" | "DISABLED"; message: string; }

function bool(name: string, fallback: boolean): boolean { const value = process.env[name]; return value === undefined ? fallback : value.toLowerCase() === "true"; }
function add(checks: ReadinessCheck[], name: string, status: ReadinessCheck["status"], message: string): void { checks.push({ name, status, message }); }
function has(value: string | undefined | null): boolean { return Boolean(value?.trim()); }

async function main(): Promise<void> {
  const checks: ReadinessCheck[] = [];
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const candidateProfile = process.env.CANDIDATE_PROFILE_ID?.trim();
  const resume = process.env.CANDIDATE_RESUME_PATH?.trim();
  const gmailEnabled = bool("GMAIL_ENABLED", false);
  const gmailConfigured = has(process.env.GMAIL_CLIENT_ID) && has(process.env.GMAIL_CLIENT_SECRET) && has(process.env.GMAIL_REFRESH_TOKEN) && has(process.env.GMAIL_USER_EMAIL);
  const outboundEnabled = bool("OUTBOUND_ENABLED", false);
  const proactiveEnabled = bool("PROACTIVE_RECRUITER_ENABLED", false);
  const proactiveSendEnabled = bool("PROACTIVE_RECRUITER_SEND_ENABLED", false);
  const recruiterEnabled = bool("RECRUITER_OUTREACH_ENABLED", false) || proactiveEnabled;
  const recruiterDryRun = bool("RECRUITER_OUTREACH_DRY_RUN", true);
  const recruiterVerifiedRequired = bool("RECRUITER_REQUIRE_VERIFIED_EMAIL", true);
  const recruiterActivation = process.env.RECRUITER_OUTREACH_ACTIVATION ?? "disabled";
  const applicationDryRun = bool("APPLICATION_DRY_RUN", true);
  const applicationLive = bool("APPLICATION_LIVE_ENABLED", false);
  const automationEnabled = bool("AUTOMATION_ENABLED", false);

  add(checks, "Database", has(databaseUrl) ? "CONFIGURED" : "NOT_CONFIGURED", has(databaseUrl) ? "DATABASE_URL is configured; secrets are not displayed." : "DATABASE_URL is missing.");
  add(checks, "Candidate Profile", has(candidateProfile) ? "CONFIGURED" : "NOT_CONFIGURED", has(candidateProfile) ? "Candidate profile ID is configured." : "CANDIDATE_PROFILE_ID is missing.");
  add(checks, "Resume", has(resume) ? (fs.existsSync(resume!) ? "READY" : "BLOCKED") : "NOT_CONFIGURED", has(resume) ? (fs.existsSync(resume!) ? "Configured candidate resume exists." : "Configured candidate resume path does not exist.") : "CANDIDATE_RESUME_PATH is not configured.");
  add(checks, "Gmail Configuration", !gmailEnabled ? "DISABLED" : gmailConfigured ? "CONFIGURED" : "BLOCKED", !gmailEnabled ? "Gmail is disabled." : gmailConfigured ? "Gmail OAuth configuration is structurally complete." : "GMAIL_ENABLED=true but OAuth/user configuration is incomplete.");
  add(checks, "Gmail Authentication", !gmailEnabled ? "DISABLED" : "CONFIGURED", !gmailEnabled ? "Not applicable while Gmail is disabled; no live provider call was made." : "Run npm run gmail:verify before live activation; readiness never sends mail.");
  add(checks, "Sender Identity", !gmailEnabled ? "DISABLED" : has(process.env.GMAIL_USER_EMAIL) ? "CONFIGURED" : "BLOCKED", !gmailEnabled ? "Not applicable while Gmail is disabled." : has(process.env.GMAIL_USER_EMAIL) ? "Configured sender identity is present." : "GMAIL_USER_EMAIL is missing.");
  add(checks, "Recruiter Verification", !recruiterEnabled ? "DISABLED" : recruiterVerifiedRequired ? "READY" : "BLOCKED", !recruiterEnabled ? "Recruiter subsystem is disabled." : recruiterVerifiedRequired ? "Strict mailbox-level verification is required." : "RECRUITER_REQUIRE_VERIFIED_EMAIL must remain true for live sending.");
  add(checks, "Suppression System", recruiterEnabled ? "READY" : "DISABLED", recruiterEnabled ? "Canonical recruiter suppression checks are enabled by the recruiter subsystem." : "Recruiter subsystem is disabled.");
  add(checks, "Outbound Configuration", !outboundEnabled ? "DISABLED" : "CONFIGURED", outboundEnabled ? "Global outbound flag is enabled; individual final gates still apply." : "Outbound side effects are disabled.");
  add(checks, "Recruiter-First Configuration", !proactiveEnabled ? "DISABLED" : "CONFIGURED", proactiveEnabled ? "Proactive recruiter discovery is independently configured." : "Proactive recruiter discovery is disabled.");
  add(checks, "Recruiter-First Send", !proactiveSendEnabled ? "DISABLED" : (gmailEnabled && outboundEnabled ? "CONFIGURED" : "BLOCKED"), !proactiveSendEnabled ? "Proactive recruiter send is disabled." : gmailEnabled && outboundEnabled ? "Proactive send flag is enabled; final send gate still applies." : "Proactive send requested but Gmail/outbound is disabled.");
  add(checks, "Proactive Campaign", proactiveEnabled ? "READY" : "DISABLED", proactiveEnabled ? "Proactive campaigns can exist without a job; jobId=NULL is supported." : "Proactive campaign engine is disabled.");
  add(checks, "Gmail Sender / Outbound Gate", gmailEnabled && outboundEnabled ? "CONFIGURED" : "DISABLED", gmailEnabled && outboundEnabled ? "Both outer Gmail and outbound gates are enabled; live send still requires activation and verification." : "Gmail or outbound is disabled.");
  add(checks, "Rate Limiting", recruiterEnabled ? "READY" : "DISABLED", recruiterEnabled ? "Database-backed recruiter send limits are enabled." : "Recruiter subsystem is disabled.");
  add(checks, "Deduplication", recruiterEnabled ? "READY" : "DISABLED", recruiterEnabled ? "Proactive campaign uniqueness and canonical recruiter message claiming are enabled." : "Recruiter subsystem is disabled.");
  add(checks, "Follow-up System", recruiterEnabled && bool("RECRUITER_FOLLOWUP_ENABLED", true) ? "READY" : "DISABLED", recruiterEnabled && bool("RECRUITER_FOLLOWUP_ENABLED", true) ? "Day 4/10/18 follow-up scheduling is enabled subject to rechecks." : "Recruiter follow-ups are disabled.");
  add(checks, "Inbound Reply Handling", gmailEnabled && recruiterEnabled ? "READY" : "DISABLED", gmailEnabled && recruiterEnabled ? "Gmail sync can route recruiter replies into the canonical recruiter campaign processor." : "Requires Gmail and recruiter subsystems.");
  add(checks, "Application Adapters", "READY", "Hosted ATS capability boundaries remain active; unsupported flows are blocked/manual review.");
  add(checks, "Browser Dependencies", "CONFIGURED", "Playwright/browser dependencies are validated by CI; no browser is launched by readiness.");
  add(checks, "Worker", "CONFIGURED", "Continuous worker is available through the existing TaskWorker infrastructure.");
  add(checks, "Scheduler", "CONFIGURED", "Existing discovery/recruiter/application schedulers are retained.");
  add(checks, "Kill Switch", has(databaseUrl) ? "CONFIGURED" : "BLOCKED", has(databaseUrl) ? "Database-backed global emergency stop is checked before irreversible external actions." : "Cannot inspect kill switch without a database.");
  add(checks, "Security", "READY", "Readiness does not reveal secrets or execute external side effects.");
  add(checks, "Production Database Identity", has(databaseUrl) ? "CONFIGURED" : "NOT_CONFIGURED", has(databaseUrl) ? "Database identity will be queried without printing credentials." : "DATABASE_URL is missing.");
  add(checks, "Production Mode", !automationEnabled ? "DISABLED" : applicationDryRun || !applicationLive ? "ARMED" : "LIVE", !automationEnabled ? "AUTOMATION_ENABLED=false." : applicationDryRun || !applicationLive ? "Automation is enabled but live application submission is not armed." : "Application live flag is enabled; Phase 9 safety gates still apply.");
  add(checks, "Activation State", recruiterActivation === "disabled" ? "DISABLED" : recruiterDryRun ? "CONFIGURED" : recruiterActivation === "canary" ? "ARMED" : "LIVE", recruiterDryRun ? "Recruiter outreach remains dry-run." : `Recruiter activation mode is ${recruiterActivation}.`);

  if (databaseUrl) {
    const db = new Database(databaseUrl);
    try {
      const migration = await db.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1");
      const kill = await db.query<{ kill_switch_active: boolean; reason: string | null }>("SELECT kill_switch_active, reason FROM runtime_safety_controls WHERE id=TRUE");
      const tables = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('recruiter_contacts','recruiter_outreach_sequences','recruiter_outreach_messages','recruiter_suppressions','runtime_safety_controls')");
      add(checks, "Migrations", migration.rows[0]?.name === "038_phase10_activation_safety.sql" ? "READY" : "BLOCKED", migration.rows[0]?.name ? `Latest migration: ${migration.rows[0].name}.` : "No migration history found.");
      add(checks, "Kill Switch State", kill.rows[0] ? (kill.rows[0].kill_switch_active ? "BLOCKED" : "ARMED") : "BLOCKED", kill.rows[0] ? (kill.rows[0].kill_switch_active ? "Global emergency stop is ACTIVE; live external side effects are blocked." : "Global emergency stop is inactive; individual activation gates still apply.") : "Global emergency stop row is missing.");
      add(checks, "Recruiter Schema", tables.rows[0]?.count === "5" ? "READY" : "BLOCKED", `Required recruiter/activation tables present: ${tables.rows[0]?.count ?? "0"}/5.`);
    } finally { await db.close(); }
  }

  const blockers = checks.filter((check) => check.status === "BLOCKED").length;
  const liveReady = blockers === 0 && gmailEnabled && outboundEnabled && !recruiterDryRun && recruiterActivation !== "disabled";
  const status = liveReady ? "LIVE" : blockers > 0 ? "BLOCKED" : "READY";
  console.log(JSON.stringify({ status, checks, note: "LIVE status is configuration/readiness only. No Gmail send, recruiter outreach, application submission, or other external side effect is performed by this command." }, null, 2));
  if (blockers > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
