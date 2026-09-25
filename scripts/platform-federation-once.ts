import "dotenv/config";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pino from "pino";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { TaskQueue } from "../src/queue/TaskQueue";
import { createDiscoveryRuntime } from "../src/discovery/createDiscoveryRuntime";
import { JOB_PLATFORM_REGISTRY } from "../src/jobs/sources/JobPlatformRegistry";

function isRunningInsideDocker(): boolean {
  return existsSync("/.dockerenv");
}

function runInsideComposeApp(): never {
  const result = spawnSync(
    "docker",
    ["compose", "exec", "-T", "app", "node", "dist/scripts/platform-federation-once.js"],
    { stdio: "inherit" }
  );
  if (result.error) throw new Error(`Unable to execute federation inside the Docker app container: ${result.error.message}`);
  process.exitCode = result.status ?? 1;
  process.exit();
}

async function main(): Promise<void> {
  if (!isRunningInsideDocker() && process.env.PLATFORM_FEDERATION_IN_CONTAINER !== "1") runInsideComposeApp();

  const config = loadConfig();
  const sources = JSON.parse(process.env.JOB_SOURCES ?? "[]") as Array<{ name?: string; id?: string; status?: string }>;
  const platformSource = sources.find((source) => source.name?.trim().toLowerCase() === "platform-search");
  if (!platformSource) {
    throw new Error("JOB_SOURCES must contain the platform-search source before a full federation run.");
  }
  if (platformSource.status === "DISABLED") {
    throw new Error("The platform-search source is DISABLED; refusing to claim federation coverage.");
  }

  const executable = JOB_PLATFORM_REGISTRY.filter((platform) => platform.capability !== "catalog-only");
  const logger = pino({ level: config.logLevel });
  const database = new Database(config.databaseUrl);

  try {
    await new MigrationRunner(database).run();
    const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
    const candidateProfile = await candidateProfiles.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");

    const runtime = createDiscoveryRuntime(database, new TaskQueue(database), config, candidateProfile);
    if (runtime.sourceCount < 1) throw new Error("No runnable discovery sources are registered.");

    const before = await database.query<{ jobs: string; matches: string }>(
      `SELECT (SELECT COUNT(*)::text FROM job_opportunities) AS jobs,
              (SELECT COUNT(DISTINCT job_opportunity_id)::text FROM match_decisions) AS matches`
    );

    const startedAt = new Date().toISOString();
    const results = await runtime.runner.runOnce();
    const completedAt = new Date().toISOString();

    const after = await database.query<{ jobs: string; matches: string }>(
      `SELECT (SELECT COUNT(*)::text FROM job_opportunities) AS jobs,
              (SELECT COUNT(DISTINCT job_opportunity_id)::text FROM match_decisions) AS matches`
    );

    const latest = await database.query<{
      platform_id: string; platform_name: string; capability: string; outcome: string;
      fetched: string; normalized: string | null; inserted: string; duplicates: string;
      duration_ms: string; completed_at: string; error_detail: string | null;
    }>(
      `SELECT DISTINCT ON (platform_id)
         platform_id, platform_name, capability, outcome, fetched, normalized,
         inserted, duplicates, duration_ms, completed_at, error_detail
       FROM platform_discovery_runs
       ORDER BY platform_id, completed_at DESC`
    );

    const executableIds = new Set(executable.map((platform) => platform.id));
    const executed = latest.rows.filter((row) => executableIds.has(row.platform_id));
    const executedIds = new Set(executed.map((row) => row.platform_id));
    const notExecuted = executable.filter((platform) => !executedIds.has(platform.id)).map((platform) => platform.name);

    const payload = {
      status: notExecuted.length === 0 ? "FULL_EXECUTABLE_FEDERATION_COMPLETED" : "FEDERATION_INCOMPLETE",
      startedAt,
      completedAt,
      registry: {
        total: JOB_PLATFORM_REGISTRY.length,
        activeAdapters: JOB_PLATFORM_REGISTRY.filter((p) => p.capability === "active-adapter").length,
        configurableAdapters: JOB_PLATFORM_REGISTRY.filter((p) => p.capability === "configurable-adapter").length,
        catalogOnly: JOB_PLATFORM_REGISTRY.filter((p) => p.capability === "catalog-only").length,
        executable: executable.length
      },
      runtime: {
        sourceCount: runtime.sourceCount,
        resultCount: results.length,
        before: before.rows[0] ?? null,
        after: after.rows[0] ?? null
      },
      coverage: {
        executed: executed.length,
        notExecuted: notExecuted.length,
        notExecutedPlatforms: notExecuted,
        results: executed
      }
    };

    logger.info(payload, "Full executable platform federation run completed");
    console.log(JSON.stringify(payload, null, 2));
    if (notExecuted.length > 0) process.exitCode = 2;
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: "FAILED", error: message }, null, 2));
  process.exitCode = 1;
});
