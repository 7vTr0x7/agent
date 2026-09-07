import "dotenv/config";
import { createDiscoveryRuntime } from "../src/discovery/createDiscoveryRuntime";
import { TaskQueue } from "../src/queue/TaskQueue";
import { TaskWorker } from "../src/queue/TaskWorker";
import { createConfig } from "../src/config/env";
import { createDatabasePool } from "../src/database/createDatabasePool";

async function main(): Promise<void> {
  const config = createConfig();
  const pool = createDatabasePool(config.databaseUrl);
  const queue = new TaskQueue(pool);
  const runtime = await createDiscoveryRuntime(config, pool);
  const worker = new TaskWorker(queue, new Map([["MATCH_JOB", runtime.matchTaskHandler]]), {
    workerId: `matching-smoke-${process.pid}`,
    pollIntervalMs: 50,
    staleRecoveryIntervalMs: 30_000,
    heartbeatIntervalMs: 20_000
  });

  const requestedLimit = Number.parseInt(process.env.MATCHING_SMOKE_LIMIT ?? "100", 10);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 100;
  let processed = 0;

  try {
    while (processed < limit) {
      const didProcess = await worker.runOnce();
      if (!didProcess) break;
      processed += 1;
    }

    const result = await pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM tasks
       WHERE task_type = 'MATCH_JOB'
       GROUP BY status
       ORDER BY status`
    );

    console.log(JSON.stringify({ processed, taskStatus: result.rows }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
