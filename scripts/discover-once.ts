import "dotenv/config";
import pino from "pino";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { TaskQueue } from "../src/queue/TaskQueue";
import { createDiscoveryRuntime } from "../src/discovery/createDiscoveryRuntime";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  const database = new Database(config.databaseUrl);

  try {
    await new MigrationRunner(database).run();
    const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
    const candidateProfile = await candidateProfiles.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");

    const runtime = createDiscoveryRuntime(database, new TaskQueue(database), config, candidateProfile);
    const results = await runtime.runner.runOnce();
    logger.info({ sourceCount: runtime.sourceCount, results }, "Discovery smoke run completed");
    console.log(JSON.stringify({ sourceCount: runtime.sourceCount, results }, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: "FAILED", error: message }, null, 2));
  process.exitCode = 1;
});
