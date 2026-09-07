import "dotenv/config";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { TaskQueue } from "../src/queue/TaskQueue";
import { TaskWorker } from "../src/queue/TaskWorker";
import { createDiscoveryRuntime } from "../src/discovery/createDiscoveryRuntime";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = new Database(config.databaseUrl);

  try {
    await new MigrationRunner(database).run();

    const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
    const candidateProfile = await candidateProfiles.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!candidateProfile) {
      throw new Error("Configured candidate profile could not be resolved.");
    }

    const queue = new TaskQueue(database);
    const runtime = createDiscoveryRuntime(database, queue, config, candidateProfile);
    const worker = new TaskWorker(
      queue,
      new Map([["MATCH_JOB", runtime.matchTaskHandler]]),
      {
        workerId: `matching-smoke-${process.pid}`,
        pollIntervalMs: 50,
        staleRecoveryIntervalMs: 30_000,
        heartbeatIntervalMs: 20_000
      }
    );

    const requestedLimit = Number.parseInt(process.env.MATCHING_SMOKE_LIMIT ?? "100", 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 100;
    let processed = 0;

    while (processed < limit) {
      const didProcess = await worker.runOnce(["MATCH_JOB"]);
      if (!didProcess) break;
      processed += 1;
    }

    const result = await database.query(
      `SELECT status, COUNT(*)::int AS count
       FROM tasks
       WHERE task_type = 'MATCH_JOB'
       GROUP BY status
       ORDER BY status`
    );

    console.log(JSON.stringify({ processed, taskStatus: result.rows }, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
