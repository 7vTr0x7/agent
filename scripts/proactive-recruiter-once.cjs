const { loadConfig } = require("../dist/config/env");
const { Database } = require("../dist/database/Database");
const { TaskQueue } = require("../dist/queue/TaskQueue");
const { ConfiguredCandidateProfileResolver } = require("../dist/candidates/ConfiguredCandidateProfileResolver");
const { RecruiterOutreachSendTaskDispatcher } = require("../dist/recruiters/RecruiterOutreachSendTask");
const { ProactiveRecruiterDiscoveryService } = require("../dist/recruiters/ProactiveRecruiterDiscoveryService");
const { ProactiveRecruiterRepository } = require("../dist/recruiters/ProactiveRecruiterRepository");
const { ProactiveRecruiterTaskHandler } = require("../dist/recruiters/ProactiveRecruiterTaskHandler");

async function main() {
  const config = loadConfig();
  if (!config.proactiveRecruiter.enabled) throw new Error("PROACTIVE_RECRUITER_ENABLED must be true for proactive-recruiter:once.");
  const database = new Database(config.databaseUrl);
  const fixtureMode = process.env.PROACTIVE_RECRUITER_FIXTURE === "true";
  const logger = {
    info(payload, message) { console.log(JSON.stringify({ ...(payload && typeof payload === "object" ? payload : { payload }), msg: message })); },
    error(payload, message) { console.error(JSON.stringify({ ...(payload && typeof payload === "object" ? payload : { payload }), msg: message })); }
  };
  try {
    const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID || "");
    if (!profile) throw new Error("Configured candidate profile could not be resolved.");
    const taskQueue = new TaskQueue(database);
    const fixturePage = "Jane Doe - Technical Recruiter at Acme Corp actively hiring React frontend engineers <https://linkedin.com/in/jane-doe> jane@acme.com";
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
      candidateName: profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || undefined,
      yearsExperience: profile.yearsExperience,
      skills: [...profile.skills],
      targetRoles: [...profile.targetTitles],
      location: profile.location,
      preferredLocations: (process.env.CANDIDATE_PREFERRED_LOCATIONS || "Bengaluru,Bangalore,India,Remote").split(",").map((value) => value.trim()).filter(Boolean),
      remoteEligible: process.env.CANDIDATE_REMOTE_ELIGIBLE !== "false",
      maxCandidates: config.proactiveRecruiter.maxCandidatesPerRun
    });
    console.log(JSON.stringify({ status: "ok", mode: "isolated-proactive-recruiter", sendEnabled: false, gmailEnabled: false, outboundEnabled: false }));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});