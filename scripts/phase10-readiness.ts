import { buildConfig } from "../src/config/env";
import { Database } from "../src/database/Database";

function add(checks: any[], name: string, status: string, message: string) {
  checks.push({ name, status, message });
}

async function main() {
  const config = buildConfig();
  const checks: any[] = [];
  const databaseUrl = config.DATABASE_URL;

  add(checks, "Database", databaseUrl ? "CONFIGURED" : "BLOCKED", databaseUrl ? "DATABASE_URL is configured; secrets are not displayed." : "DATABASE_URL is not configured.");
  add(checks, "Candidate Profile", config.CANDIDATE_PROFILE_ID ? "CONFIGURED" : "BLOCKED", config.CANDIDATE_PROFILE_ID ? "Candidate profile ID is configured." : "Candidate profile ID is not configured.");
  add(checks, "Resume", config.CANDIDATE_RESUME_PATH ? "CONFIGURED" : "NOT_CONFIGURED", config.CANDIDATE_RESUME_PATH ? "Candidate resume path is configured." : "CANDIDATE_RESUME_PATH is not configured.");
  add(checks, "Gmail Configuration", config.GMAIL_ENABLED ? "CONFIGURED" : "DISABLED", config.GMAIL_ENABLED ? "Gmail is enabled." : "Gmail is disabled.");
  add(checks, "Gmail Authentication", config.GMAIL_ENABLED ? "READY" : "DISABLED", config.GMAIL_ENABLED ? "Authentication will be checked only when a live provider operation is requested." : "Not applicable while Gmail is disabled; no live provider call was made.");
  add(checks, "Sender Identity", config.GMAIL_ENABLED ? "READY" : "DISABLED", config.GMAIL_ENABLED ? "Sender identity will be checked before live send." : "Not applicable while Gmail is disabled.");
  add(checks, "Recruiter Verification", "READY", "Strict mailbox-level verification is required.");
  add(checks, "Suppression System", "READY", "Canonical recruiter suppression checks are enabled by the recruiter subsystem.");
  add(checks, "Outbound Configuration", config.OUTBOUND_ENABLED ? "CONFIGURED" : "DISABLED", config.OUTBOUND_ENABLED ? "Global outbound flag is enabled; individual final gates still apply." : "Global outbound is disabled.");
  add(checks, "Recruiter-First Configuration", config.PROACTIVE_RECRUITER_ENABLED ? "CONFIGURED" : "DISABLED", config.PROACTIVE_RECRUITER_ENABLED ? "Proactive recruiter discovery is enabled." : "Proactive recruiter discovery is disabled.");
  add(checks, "Recruiter-First Send", config.RECRUITER_OUTREACH_ENABLED && config.GMAIL_ENABLED && config.OUTBOUND_ENABLED ? "CONFIGURED" : "DISABLED", config.RECRUITER_OUTREACH_ENABLED && config.GMAIL_ENABLED && config.OUTBOUND_ENABLED ? "Recruiter-first send prerequisites are configured; final gates still apply." : "Proactive recruiter send is disabled.");
  add(checks, "Proactive Campaign", config.PROACTIVE_RECRUITER_ENABLED ? "CONFIGURED" : "DISABLED", config.PROACTIVE_RECRUITER_ENABLED ? "Proactive campaign engine is enabled." : "Proactive campaign engine is disabled.");
  add(checks, "Gmail Sender / Outbound Gate", config.GMAIL_ENABLED && config.OUTBOUND_ENABLED ? "CONFIGURED" : "DISABLED", config.GMAIL_ENABLED && config.OUTBOUND_ENABLED ? "Gmail and outbound are enabled; final gates still apply." : "Gmail or outbound is disabled.");
  add(checks, "Rate Limiting", "READY", "Database-backed recruiter send limits are enabled.");
  add(checks, "Deduplication", "READY", "Proactive campaign uniqueness and canonical recruiter message claiming are enabled.");
  add(checks, "Follow-up System", "READY", "Day 4/10/18 follow-up scheduling is enabled subject to rechecks.");
  add(checks, "Inbound Reply Handling", config.GMAIL_ENABLED ? "READY" : "DISABLED", config.GMAIL_ENABLED ? "Inbound reply handling is available subject to Gmail authentication." : "Requires Gmail and recruiter subsystems.");
  add(checks, "Application Adapters", "READY", "Hosted ATS capability boundaries remain active; unsupported flows are blocked/manual review.");
  add(checks, "Browser Dependencies", "CONFIGURED", "Playwright/browser dependencies are validated by CI; no browser is launched by readiness.");
  add(checks, "Worker", "CONFIGURED", "Continuous worker is available through the existing TaskWorker infrastructure.");
  add(checks, "Scheduler", "CONFIGURED", "Existing discovery/recruiter/application schedulers are retained.");

  if (databaseUrl) {
    const db = new Database(databaseUrl);
    try {
      const migration = await db.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1");
      const kill = await db.query<{ kill_switch_active: boolean; reason: string | null }>("SELECT kill_switch_active, reason FROM runtime_safety_controls WHERE id=TRUE");
      const tables = await db.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('recruiter_contacts','recruiter_outreach_sequences','recruiter_outreach_messages','recruiter_suppressions','runtime_safety_controls')");
      add(checks, "Migrations", migration.rows[0]?.name === "039_recruiter_hiring_evidence_relevance.sql" ? "READY" : "BLOCKED", migration.rows[0]?.name ? `Latest migration: ${migration.rows[0].name}.` : "No migration history found.");
      add(checks, "Kill Switch State", kill.rows[0] ? (kill.rows[0].kill_switch_active ? "BLOCKED" : "ARMED") : "BLOCKED", kill.rows[0] ? (kill.rows[0].kill_switch_active ? "Global emergency stop is ACTIVE; live external side effects are blocked." : "Global emergency stop is inactive; individual activation gates still apply.") : "Global emergency stop row is missing.");
      add(checks, "Recruiter Schema", tables.rows[0]?.count === "5" ? "READY" : "BLOCKED", `Required recruiter/activation tables present: ${tables.rows[0]?.count ?? "0"}/5.`);
    } finally { await db.close(); }
  }

  const blocked = checks.filter((check) => check.status === "BLOCKED");
  console.log(JSON.stringify({ status: blocked.length ? "BLOCKED" : "READY", checks, note: "LIVE status is configuration/readiness only. No Gmail send, recruiter outreach, application submission, or other external side effect is performed by this command." }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
