import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { TaskQueue } from "../src/queue/TaskQueue";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { RecruiterOutreachSendTaskDispatcher } from "../src/recruiters/RecruiterOutreachSendTask";
import { ProactiveRecruiterDiscoveryService } from "../src/recruiters/ProactiveRecruiterDiscoveryService";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";
import { ProactiveRecruiterTaskHandler } from "../src/recruiters/ProactiveRecruiterTaskHandler";
import { PublicHiringPostDiscoveryProvider } from "../src/recruiters/PublicHiringPostDiscoveryProvider";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.proactiveRecruiter.enabled) throw new Error("PROACTIVE_RECRUITER_ENABLED must be true for proactive-recruiter:once.");
  const database = new Database(config.databaseUrl);
  const fixtureMode = process.env.PROACTIVE_RECRUITER_FIXTURE === "true";
  const logger = {
    info: (payload: unknown, message: string) => console.log(JSON.stringify({ ...(typeof payload === "object" && payload ? payload : { payload }), msg: message })),
    error: (payload: unknown, message: string) => console.error(JSON.stringify({ ...(typeof payload === "object" && payload ? payload : { payload }), msg: message }))
  };
  try {
    const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!profile) throw new Error("Configured candidate profile could not be resolved.");
    const taskQueue = new TaskQueue(database);
    const fixturePage = `Jane Doe - Technical Recruiter at Acme Corp actively hiring React frontend engineers <https://linkedin.com/in/jane-doe> jane@acme.com`;
    const maxQueriesRaw = Number.parseInt(process.env.PROACTIVE_RECRUITER_MAX_QUERIES ?? "18", 10);
    const maxQueries = Number.isInteger(maxQueriesRaw) && maxQueriesRaw > 0 ? maxQueriesRaw : 18;
    const discovery = new ProactiveRecruiterDiscoveryService({
      ...(fixtureMode ? { fetchText: async () => fixturePage } : {}),
      maxQueries
    });
    const handler = new ProactiveRecruiterTaskHandler(
      discovery,
      new ProactiveRecruiterRepository(database),
      new RecruiterOutreachSendTaskDispatcher(taskQueue),
      { enabled: true, sendEnabled: false, maxCandidatesPerRun: config.proactiveRecruiter.maxCandidatesPerRun, requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail },
      logger
    );
    const hiringPostDiscovery = new PublicHiringPostDiscoveryProvider();
    const hiringPostPromise = hiringPostDiscovery.discover({
      targetRoles: [...profile.targetTitles],
      skills: [...profile.skills],
      location: profile.location,
      preferredLocations: (process.env.CANDIDATE_PREFERRED_LOCATIONS ?? "Bengaluru,Bangalore,India,Remote").split(",").map((value) => value.trim()).filter(Boolean),
      maxQueries: Number.parseInt(process.env.PUBLIC_HIRING_POST_MAX_QUERIES ?? "8", 10)
    });

    await handler.handleDiscovery({
      candidateProfileId: profile.id,
      candidateName: profile.fullName ?? ([profile.firstName, profile.lastName].filter(Boolean).join(" ") || undefined),
      yearsExperience: profile.yearsExperience,
      skills: [...profile.skills],
      targetRoles: [...profile.targetTitles],
      location: profile.location,
      preferredLocations: (process.env.CANDIDATE_PREFERRED_LOCATIONS ?? "Bengaluru,Bangalore,India,Remote").split(",").map((value) => value.trim()).filter(Boolean),
      remoteEligible: process.env.CANDIDATE_REMOTE_ELIGIBLE !== "false",
      maxCandidates: config.proactiveRecruiter.maxCandidatesPerRun
    });

    const hiringPostResult = await hiringPostPromise;
    const hiringPostPersisted: string[] = [];
    const hiringPostRepository = new ProactiveRecruiterRepository(database);
    for (const candidate of hiringPostResult.candidates) {
      const id = await hiringPostRepository.persistCandidate(profile.id, candidate);
      if (id) hiringPostPersisted.push(id);
    }
    const metrics = discovery.getLastRunMetrics();
    const operationalStatus = "SUCCESS";
    const discoveryStatus = metrics.finalDiscovered > 0 ? "CANDIDATES_DISCOVERED" : "NO_CANDIDATES";
    const qualityStatus = metrics.identityValidated > 0 && metrics.companyValidated > 0 && metrics.recruiterEvidenceMatches > 0 && metrics.finalDiscovered > 0
      ? "QUALITY_EVIDENCE_PRESENT"
      : "NO_QUALITY_CANDIDATES";
    const persistedLeads = await database.query<{
      name: string | null;
      company: string;
      role: string | null;
      email: string | null;
      email_status: string | null;
      verified: boolean;
      mailbox_evidence: boolean;
      relevance_status: string | null;
      relevance_score: number | null;
      confidence: number | null;
    }>(
      `SELECT full_name AS name, company_name AS company, title AS role, email, email_status,
              verified, mailbox_evidence, relevance_status, relevance_score, confidence
       FROM recruiter_contacts
       WHERE relevance_status IN ('CURRENT','RECENT')
       ORDER BY relevance_score DESC NULLS LAST, confidence DESC NULLS LAST, updated_at DESC
       LIMIT 10`
    );
    console.log(JSON.stringify({ status: "ok", operationalStatus, discoveryStatus, qualityStatus, discovered: metrics.finalDiscovered, persisted: persistedLeads.rows.length, metrics, persistedLeads: persistedLeads.rows, mode: "isolated-proactive-recruiter", sendEnabled: false, gmailEnabled: false, outboundEnabled: false, hiringPostDiscovery: hiringPostResult.metrics, hiringPostCandidates: hiringPostResult.candidates.length, hiringPostPersisted: hiringPostPersisted.length }, null, 2));
  } finally {
    await database.close();
  }
}

main().then(() => process.exit(0)).catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
