import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { TaskQueue } from "../src/queue/TaskQueue";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { RecruiterOutreachSendTaskDispatcher } from "../src/recruiters/RecruiterOutreachSendTask";
import { ProactiveRecruiterDiscoveryService } from "../src/recruiters/ProactiveRecruiterDiscoveryService";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";
import { ProactiveRecruiterTaskHandler } from "../src/recruiters/ProactiveRecruiterTaskHandler";
import { PublicHiringPostDiscoveryProvider } from "../src/recruiters/PublicHiringPostDiscoveryProvider";
import { PublicRecruiterSearchProvider } from "../src/recruiters/PublicRecruiterSearchProvider";

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

    const preferredLocations = (process.env.CANDIDATE_PREFERRED_LOCATIONS ?? "Bengaluru,Bangalore,India,Remote").split(",").map((value) => value.trim()).filter(Boolean);
    const hiringPostDiscovery = new PublicHiringPostDiscoveryProvider();
    const hiringPostResult = await hiringPostDiscovery.discover({
      targetRoles: [...profile.targetTitles],
      skills: [...profile.skills],
      yearsExperience: profile.yearsExperience,
      location: profile.location,
      preferredLocations,
      maxQueries: Number.parseInt(process.env.PUBLIC_HIRING_POST_MAX_QUERIES ?? "8", 10)
    });

    const hiringPostPersisted: string[] = [];
    const hiringPostRepository = new ProactiveRecruiterRepository(database);
    const verifier = new PublicRecruiterSearchProvider();

    for (const candidate of hiringPostResult.candidates) {
      if (!candidate.email && candidate.employerDomain) {
        try {
          const enriched = await verifier.discover({
            companyName: candidate.employer,
            companyDomain: candidate.employerDomain,
            jobTitle: candidate.targetRoles[0] ?? "Frontend Engineer",
            jobDescription: candidate.discoveryEvidence.join(" "),
            candidateProfileId: profile.id
          });
          const sameIdentity = enriched.contacts.find(contact =>
            contact.email &&
            ((candidate.recruiterName && contact.fullName && contact.fullName.toLowerCase() === candidate.recruiterName.toLowerCase()) ||
             (candidate.recruiterRole && contact.title && contact.title.toLowerCase().includes(candidate.recruiterRole.toLowerCase().split(" ")[0] ?? "")))
          );
          if (sameIdentity?.email) {
            candidate.email = sameIdentity.email;
            candidate.emailStatus = "UNVERIFIED";
            candidate.verificationEvidence = [];
            hiringPostResult.metrics.publicEmailsFound += 1;
          }
        } catch (error) {
          logger.error({ error: error instanceof Error ? error.message : String(error), employer: candidate.employer }, "Public email enrichment for hiring-post author failed");
        }
      }

      if (candidate.email) {
        try {
          const verification = await verifier.verify(candidate.email);
          candidate.emailStatus = verification.status === "domain_mx_verified" || verification.status === "domain_mx_verified_doh" ? "LIKELY"
            : verification.status === "invalid" || verification.status === "no_mx_record" ? "INVALID"
            : verification.status === "mailbox_verified" && verification.verificationEvidence?.some(item => item.mailboxLevel === true) ? "VERIFIED"
            : "UNVERIFIED";
          candidate.verificationEvidence = verification.verificationEvidence ?? [];
        } catch (error) {
          logger.error({ error: error instanceof Error ? error.message : String(error), email: candidate.email }, "Hiring-post email validation failed");
          candidate.emailStatus = "UNVERIFIED";
          candidate.verificationEvidence = [];
        }
      }

      const id = await hiringPostRepository.persistCandidate(profile.id, candidate);
      if (id) hiringPostPersisted.push(id);
    }

    await handler.handleDiscovery({
      candidateProfileId: profile.id,
      candidateName: profile.fullName ?? ([profile.firstName, profile.lastName].filter(Boolean).join(" ") || undefined),
      yearsExperience: profile.yearsExperience,
      skills: [...profile.skills],
      targetRoles: [...profile.targetTitles],
      location: profile.location,
      preferredLocations,
      remoteEligible: process.env.CANDIDATE_REMOTE_ELIGIBLE !== "false",
      maxCandidates: config.proactiveRecruiter.maxCandidatesPerRun
    });

    const hiringPostPersistedRecords = hiringPostPersisted.length
      ? (await database.query<{
          id: string;
          name: string | null;
          company: string;
          role: string | null;
          email: string | null;
          email_status: string | null;
          relevance_status: string | null;
          relevance_score: number | null;
          source_url: string | null;
        }>(
          `SELECT c.id, c.full_name AS name, c.company_name AS company, c.title AS role,
                  c.email, c.email_status, c.relevance_status, c.relevance_score,
                  s.source_url
           FROM recruiter_contacts c
           LEFT JOIN recruiter_contact_sources s
             ON s.recruiter_contact_id=c.id
            AND s.provider='proactive-public-web'
           WHERE c.id = ANY($1::uuid[])
           ORDER BY c.updated_at DESC, s.observed_at DESC`,
          [hiringPostPersisted]
        )).rows
      : [];

    const metrics = discovery.getLastRunMetrics();
    const operationalStatus = "SUCCESS";
    const discoveryStatus = metrics.finalDiscovered > 0 ? "CANDIDATES_DISCOVERED" : "NO_CANDIDATES";
    const qualityStatus = metrics.identityValidated > 0 && metrics.companyValidated > 0 && metrics.recruiterEvidenceMatches > 0 && metrics.finalDiscovered > 0
      ? "QUALITY_EVIDENCE_PRESENT"
      : "NO_QUALITY_CANDIDATES";
    const persistedLeads = await database.query<{
      name: string | null; company: string; role: string | null; email: string | null;
      email_status: string | null; verified: boolean; mailbox_evidence: boolean;
      relevance_status: string | null; relevance_score: number | null; confidence: number | null;
    }>(
      `SELECT full_name AS name, company_name AS company, title AS role, email, email_status,
              verified, mailbox_evidence, relevance_status, relevance_score, confidence
       FROM recruiter_contacts
       WHERE relevance_status IN ('CURRENT','RECENT')
       ORDER BY relevance_score DESC NULLS LAST, confidence DESC NULLS LAST, updated_at DESC
       LIMIT 10`
    );
    console.log(JSON.stringify({
      status: "ok", operationalStatus, discoveryStatus, qualityStatus,
      discovered: metrics.finalDiscovered, persisted: persistedLeads.rows.length,
      metrics, persistedLeads: persistedLeads.rows, mode: "isolated-proactive-recruiter",
      sendEnabled: false, gmailEnabled: false, outboundEnabled: false,
      hiringPostDiscovery: hiringPostResult.metrics,
      hiringPostCandidates: hiringPostResult.candidates.length,
      hiringPostPersisted: hiringPostPersisted.length,
      hiringPostPersistedIds: hiringPostPersisted,
      hiringPostPersistedRecords
    }, null, 2));
  } finally {
    await database.close();
  }
}
main().then(() => process.exit(0)).catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
