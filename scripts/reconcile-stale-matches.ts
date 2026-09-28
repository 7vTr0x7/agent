import "dotenv/config";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { TaskQueue } from "../src/queue/TaskQueue";
import { TaskWorker, TaskWorkerLogger } from "../src/queue/TaskWorker";
import { createDiscoveryRuntime } from "../src/discovery/createDiscoveryRuntime";

const DEFAULT_LIMIT = 5000;

const logger: TaskWorkerLogger = {
  info: (bindingsOrMessage: Record<string, unknown> | string, message?: string) => {
    console.log(JSON.stringify({ level: "info", ...(typeof bindingsOrMessage === "string" ? { msg: bindingsOrMessage } : { ...bindingsOrMessage, msg: message }) }));
  },
  warn: (bindingsOrMessage: Record<string, unknown> | string, message?: string) => {
    console.warn(JSON.stringify({ level: "warn", ...(typeof bindingsOrMessage === "string" ? { msg: bindingsOrMessage } : { ...bindingsOrMessage, msg: message }) }));
  },
  error: (bindings: Record<string, unknown>, message: string) => {
    console.error(JSON.stringify({ level: "error", ...bindings, msg: message }));
  }
};

async function main(): Promise<void> {
  const config = loadConfig();
  const database = new Database(config.databaseUrl);

  try {
    await new MigrationRunner(database).run();

    const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
    const candidateProfile = await candidateProfiles.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");

    const queue = new TaskQueue(database);
    const runtime = createDiscoveryRuntime(database, queue, config, candidateProfile);
    const requestedLimit = Number.parseInt(process.env.STALE_MATCH_RECONCILE_LIMIT ?? String(DEFAULT_LIMIT), 10);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : DEFAULT_LIMIT;

    const queued = await runtime.matchQueueService.enqueueUnmatched(candidateProfile.id, limit);
    console.log(JSON.stringify({ phase: "requeue", matcherVersion: "matcher-v6", ...queued }));

    const worker = new TaskWorker(
      queue,
      new Map([["MATCH_JOB", runtime.matchTaskHandler]]),
      {
        workerId: `stale-match-reconcile-${process.pid}`,
        pollIntervalMs: 50,
        staleRecoveryIntervalMs: 30_000,
        heartbeatIntervalMs: 2_000,
        logger
      }
    );

    let processed = 0;
    while (processed < queued.queued) {
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

    console.log(JSON.stringify({ phase: "complete", queued: queued.queued, processed, taskStatus: result.rows }, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
