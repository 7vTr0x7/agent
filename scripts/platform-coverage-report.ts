import "dotenv/config";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Database } from "../src/database/Database";
import { loadConfig } from "../src/config/env";
import { JOB_PLATFORM_REGISTRY } from "../src/jobs/sources/JobPlatformRegistry";

function isRunningInsideDocker(): boolean {
  return existsSync("/.dockerenv");
}

function runInsideComposeApp(): never {
  const result = spawnSync(
    "docker",
    ["compose", "exec", "-T", "app", "node", "dist/scripts/platform-coverage-report.js"],
    { stdio: "inherit" }
  );
  if (result.error) throw new Error(`Unable to execute platform coverage inside the Docker app container: ${result.error.message}`);
  process.exitCode = result.status ?? 1;
  process.exit();
}

const SUCCESS_OUTCOMES = new Set(["SUCCESS_WITH_JOBS", "SUCCESS_ZERO_JOBS"]);
const KNOWN_OUTCOMES = new Set([
  "SUCCESS_WITH_JOBS",
  "SUCCESS_ZERO_JOBS",
  "CATALOG_ONLY",
  "PARSER_ERROR",
  "NETWORK_ERROR",
  "HTTP_ERROR",
  "TIMEOUT",
  "RATE_LIMITED",
  "BLOCKED_OR_RESTRICTED",
  "CONFIGURATION_ERROR",
  "UNSUPPORTED",
  "UNKNOWN_ERROR"
]);

async function main(): Promise<void> {
  if (!isRunningInsideDocker() && process.env.PLATFORM_COVERAGE_IN_CONTAINER !== "1") runInsideComposeApp();

  const config = loadConfig();
  const database = new Database(config.databaseUrl);
  try {
    const latest = await database.query<{
      platform_id: string;
      platform_name: string;
      capability: string;
      outcome: string;
      extraction_mode: string | null;
      fetched: string;
      normalized: string | null;
      inserted: string;
      duplicates: string;
      duration_ms: string;
      completed_at: string;
      error_detail: string | null;
    }>(
      `SELECT DISTINCT ON (platform_id)
         platform_id,platform_name,capability,outcome,extraction_mode,
         fetched,normalized,inserted,duplicates,duration_ms,completed_at,error_detail
       FROM platform_discovery_runs
       ORDER BY platform_id,completed_at DESC,id DESC`
    );

    const counts = new Map<string, number>();
    for (const platform of JOB_PLATFORM_REGISTRY) {
      counts.set(platform.capability, (counts.get(platform.capability) ?? 0) + 1);
    }

    const registryIds = new Set(JOB_PLATFORM_REGISTRY.map((platform) => platform.id));
    const rows = latest.rows.filter((row) => registryIds.has(row.platform_id));
    const executedIds = new Set(rows.map((row) => row.platform_id));
    const notExecuted = JOB_PLATFORM_REGISTRY.filter((platform) => !executedIds.has(platform.id));
    const outcomeCount = (outcome: string): number => rows.filter((row) => row.outcome === outcome).length;
    const unknownOutcomes = rows.filter((row) => !KNOWN_OUTCOMES.has(row.outcome));

    const fetched = rows.reduce((sum, row) => sum + Number(row.fetched), 0);
    const normalized = rows.reduce((sum, row) => sum + Number(row.normalized ?? row.fetched), 0);
    const inserted = rows.reduce((sum, row) => sum + Number(row.inserted), 0);
    const duplicates = rows.reduce((sum, row) => sum + Number(row.duplicates), 0);

    console.log(JSON.stringify({
      registry: {
        total: JOB_PLATFORM_REGISTRY.length,
        activeAdapters: counts.get("active-adapter") ?? 0,
        configurableAdapters: counts.get("configurable-adapter") ?? 0,
        catalogOnly: counts.get("catalog-only") ?? 0,
        executable: JOB_PLATFORM_REGISTRY.filter((platform) => platform.capability !== "catalog-only").length
      },
      latestRuntime: {
        expected: JOB_PLATFORM_REGISTRY.length,
        attempted: rows.length,
        executed: rows.length,
        notExecuted: notExecuted.length,
        notExecutedPlatforms: notExecuted.map((platform) => ({ id: platform.id, name: platform.name, capability: platform.capability })),
        successful: rows.filter((row) => SUCCESS_OUTCOMES.has(row.outcome)).length,
        successWithJobs: outcomeCount("SUCCESS_WITH_JOBS"),
        successZeroJobs: outcomeCount("SUCCESS_ZERO_JOBS"),
        catalogOnly: outcomeCount("CATALOG_ONLY"),
        parserFailures: outcomeCount("PARSER_ERROR"),
        networkFailures: outcomeCount("NETWORK_ERROR"),
        httpFailures: outcomeCount("HTTP_ERROR"),
        timeouts: outcomeCount("TIMEOUT"),
        rateLimited: outcomeCount("RATE_LIMITED"),
        blocked: outcomeCount("BLOCKED_OR_RESTRICTED"),
        configurationErrors: outcomeCount("CONFIGURATION_ERROR"),
        unsupported: outcomeCount("UNSUPPORTED"),
        unknownFailures: unknownOutcomes.length,
        failed: rows.filter((row) => !SUCCESS_OUTCOMES.has(row.outcome) && row.outcome !== "CATALOG_ONLY").length,
        fetched,
        normalized,
        inserted,
        duplicates,
        jobsProduced: rows.filter((row) => Number(row.fetched) > 0).length
      },
      platforms: rows
    }, null, 2));

    if (notExecuted.length > 0) process.exitCode = 2;
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});