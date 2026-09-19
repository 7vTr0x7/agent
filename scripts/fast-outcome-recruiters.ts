import "dotenv/config";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { TaskQueue } from "../src/queue/TaskQueue";
import { RecruiterOutreachSendTaskDispatcher } from "../src/recruiters/RecruiterOutreachSendTask";
import { ProactiveRecruiterDiscoveryService } from "../src/recruiters/ProactiveRecruiterDiscoveryService";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";
import { ProactiveRecruiterTaskHandler } from "../src/recruiters/ProactiveRecruiterTaskHandler";

async function main(): Promise<void> {
  const startedAt = Date.now();
  const config = loadConfig();
  if (!config.proactiveRecruiter.enabled) throw new Error("PROACTIVE_RECRUITER_ENABLED must be true.");
  const database = new Database(config.databaseUrl);
  const logger = {
    info: (payload: unknown, message: string) => console.log(JSON.stringify({ ...(typeof payload === "object" && payload ? payload : { payload }), msg: message })),
    error: (payload: unknown, message: string) => console.error(JSON.stringify({ ...(typeof payload === "object" && payload ? payload : { payload }), msg: message }))
  };
  try {
    await new MigrationRunner(database).run();
    const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!profile) throw new Error("Configured candidate profile could not be resolved.");
    const taskQueue = new TaskQueue(database);
    const discovery = new ProactiveRecruiterDiscoveryService({
      maxQueries: Number(process.env.PROACTIVE_RECRUITER_MAX_QUERIES ?? "4"),
      targetCandidates: Number(process.env.PROACTIVE_RECRUITER_TARGET_CANDIDATES ?? "3")
    });
    const handler = new ProactiveRecruiterTaskHandler(
      discovery,
      new ProactiveRecruiterRepository(database),
      new RecruiterOutreachSendTaskDispatcher(taskQueue),
      { enabled: true, sendEnabled: false, maxCandidatesPerRun: config.proactiveRecruiter.maxCandidatesPerRun, requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail },
      logger
    );
    await handler.handleDiscovery({
      candidateProfileId: profile.id,
      candidateName: profile.fullName ?? ([profile.firstName, profile.lastName].filter(Boolean).join(" ") || undefined),
      yearsExperience: profile.yearsExperience,
      skills: [...profile.skills],
      targetRoles: [...profile.targetTitles],
      location: profile.location,
      preferredLocations: (process.env.CANDIDATE_PREFERRED_LOCATIONS ?? "Bengaluru,Bangalore,India,Remote").split(",").map(v => v.trim()).filter(Boolean),
      remoteEligible: process.env.CANDIDATE_REMOTE_ELIGIBLE !== "false",
      maxCandidates: Number(process.env.PROACTIVE_RECRUITER_TARGET_CANDIDATES ?? "3")
    });
    const metrics = discovery.getLastRunMetrics();
    const leads = await database.query("SELECT c.full_name AS recruiter,c.company_name AS company,c.title AS role,c.email,c.email_status,c.verified,c.mailbox_evidence,c.confidence,c.relevance_status,c.verification_status,c.linkedin_profile_url,e.evidence_type,e.evidence_freshness,e.discovery_url,e.discovery_evidence FROM recruiter_contacts c LEFT JOIN LATERAL (SELECT evidence_type,evidence_freshness,discovery_url,discovery_evidence FROM recruiter_proactive_evidence WHERE recruiter_contact_id=c.id ORDER BY updated_at DESC LIMIT 1) e ON TRUE WHERE c.discovery_source='proactive-public-web' ORDER BY c.updated_at DESC LIMIT 10");
    const sent = await database.query("SELECT COUNT(*)::text AS count FROM recruiter_outreach_messages WHERE status='SENT'");
    const applications = await database.query("SELECT COUNT(*)::text AS count FROM applications WHERE status IN ('SUBMITTED','IN_PROGRESS')");
    console.log(JSON.stringify({
      status: "ok",
      mode: "fast-real-data-recruiters",
      durationMs: Date.now() - startedAt,
      bounded: { maxQueries: Number(process.env.PROACTIVE_RECRUITER_MAX_QUERIES ?? "4"), targetCandidates: Number(process.env.PROACTIVE_RECRUITER_TARGET_CANDIDATES ?? "3") },
      metrics,
      persistedLeads: leads.rows,
      sideEffects: { gmailEnabled: process.env.GMAIL_ENABLED === "true", outboundEnabled: process.env.OUTBOUND_ENABLED === "true", emailsSent: Number(sent.rows[0]?.count ?? 0), applicationsInProgressOrSubmitted: Number(applications.rows[0]?.count ?? 0) }
    }, null, 2));
  } finally {
    await database.close();
  }
}
main().catch((error: unknown) => { console.error(JSON.stringify({ status: "FAILED", error: error instanceof Error ? error.message : String(error) }, null, 2)); process.exitCode = 1; });
