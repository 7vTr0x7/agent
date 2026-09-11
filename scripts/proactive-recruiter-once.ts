import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { TaskQueue } from "../src/queue/TaskQueue";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { RecruiterOutreachSendTaskDispatcher } from "../src/recruiters/RecruiterOutreachSendTask";
import { ProactiveRecruiterDiscoveryService } from "../src/recruiters/ProactiveRecruiterDiscoveryService";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";
import { ProactiveRecruiterTaskHandler } from "../src/recruiters/ProactiveRecruiterTaskHandler";

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
    const discovery = new ProactiveRecruiterDiscoveryService(fixtureMode ? { fetchText: async () => fixturePage } : {});
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
      preferredLocations: (process.env.CANDIDATE_PREFERRED_LOCATIONS ?? "Bengaluru,Bangalore,India,Remote").split(",").map((value) => value.trim()).filter(Boolean),
      remoteEligible: process.env.CANDIDATE_REMOTE_ELIGIBLE !== "false",
      maxCandidates: config.proactiveRecruiter.maxCandidatesPerRun
    });
    console.log(JSON.stringify({ status: "ok", mode: "isolated-proactive-recruiter", sendEnabled: false, gmailEnabled: false, outboundEnabled: false }));
  } finally {
    await database.close();
  }
}

main().then(() => process.exit(0)).catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exit(1); });
