import pino from "pino";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { TaskQueue } from "../src/queue/TaskQueue";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { RecruiterOutreachSendTaskDispatcher } from "../src/recruiters/RecruiterOutreachSendTask";
import { ProactiveRecruiterDiscoveryService } from "../src/recruiters/ProactiveRecruiterDiscoveryService";
import { ProactiveRecruiterRepository } from "../src/recruiters/ProactiveRecruiterRepository";
import { ProactiveRecruiterTaskHandler } from "../src/recruiters/ProactiveRecruiterTaskHandler";

async function main(): Promise<void> {
  const config = loadConfig();
  if (!config.proactiveRecruiter.enabled) throw new Error("PROACTIVE_RECRUITER_ENABLED must be true for proactive-recruiter:once.");

  const logger = pino({ level: config.logLevel });
  const database = new Database(config.databaseUrl);
  try {
    await new MigrationRunner(database).run();
    const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!profile) throw new Error("Configured candidate profile could not be resolved.");

    const taskQueue = new TaskQueue(database);
    const handler = new ProactiveRecruiterTaskHandler(
      new ProactiveRecruiterDiscoveryService(),
      new ProactiveRecruiterRepository(database),
      new RecruiterOutreachSendTaskDispatcher(taskQueue),
      {
        enabled: true,
        sendEnabled: false,
        maxCandidatesPerRun: config.proactiveRecruiter.maxCandidatesPerRun,
        requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail
      },
      logger
    );

    await handler.handleDiscovery({
      candidateProfileId: profile.id,
      candidateName: profile.fullName ?? [profile.firstName, profile.lastName].filter(Boolean).join(" ") || undefined,
      yearsExperience: profile.yearsExperience,
      skills: [...profile.skills],
      targetRoles: [...profile.targetTitles],
      location: profile.location,
      preferredLocations: (process.env.CANDIDATE_PREFERRED_LOCATIONS ?? "Bengaluru,Bangalore,India,Remote").split(",").map((value) => value.trim()).filter(Boolean),
      remoteEligible: process.env.CANDIDATE_REMOTE_ELIGIBLE !== "false",
      maxCandidates: config.proactiveRecruiter.maxCandidatesPerRun
    });
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
