import "dotenv/config";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import pino from "pino";
import { loadConfig } from "../config/env";
import { Database } from "../database/Database";
import { MigrationRunner } from "../database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../candidates/ConfiguredCandidateProfileResolver";
import { TaskQueue } from "../queue/TaskQueue";
import { createDiscoveryRuntime } from "../discovery/createDiscoveryRuntime";

interface SourceRunDiagnostic {
  source_id: string;
  source_name: string;
  status: string;
  fetched_count: number;
  inserted_count: number;
  duplicate_count: number;
  error_count: number;
  error_summary: string | null;
  started_at: Date;
  finished_at: Date | null;
}

function isRunningInsideDocker(): boolean {
  return existsSync("/.dockerenv");
}

function runInsideComposeApp(): never {
  const result = spawnSync(
    "docker",
    ["compose", "exec", "-T", "app", "node", "dist/scripts/discover-once.js"],
    { stdio: "inherit" }
  );

  if (result.error) {
    throw new Error(`Unable to execute discovery inside the Docker app container: ${result.error.message}`);
  }

  process.exitCode = result.status ?? 1;
  process.exit();
}

async function main(): Promise<void> {
  if (!isRunningInsideDocker() && process.env.DISCOVER_ONCE_IN_CONTAINER !== "1") {
    runInsideComposeApp();
  }

  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  // Keep the configured DATABASE_URL untouched. Inside Compose, the hostname
  // `postgres` is the correct service address; rewriting it to 127.0.0.1 would
  // incorrectly point the app container back at itself.
  const database = new Database(config.databaseUrl);

  try {
    await new MigrationRunner(database).run();
    const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
    const candidateProfile = await candidateProfiles.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");

    const runtime = createDiscoveryRuntime(database, new TaskQueue(database), config, candidateProfile);
    const results = await runtime.runner.runOnce();

    const diagnostics = await database.query<SourceRunDiagnostic>(
      `
        SELECT
          s.id AS source_id,
          s.name AS source_name,
          sr.status,
          sr.fetched_count,
          sr.inserted_count,
          sr.duplicate_count,
          sr.error_count,
          sr.error_summary,
          sr.started_at,
          sr.finished_at
        FROM source_runs sr
        JOIN sources s ON s.id = sr.source_id
        ORDER BY sr.started_at DESC
        LIMIT $1
      `,
      [Math.max(runtime.sourceCount, 1)]
    );

    const payload = {
      sourceCount: runtime.sourceCount,
      results,
      diagnostics: diagnostics.rows,
      actionable: results.length > 0
        ? "Discovery completed with at least one source result."
        : diagnostics.rows.length === 0
          ? "No source run was recorded; inspect source registration/health gating."
          : diagnostics.rows.map((run) => ({
              source: run.source_id,
              status: run.status,
              error: run.error_summary,
              fetched: run.fetched_count,
              inserted: run.inserted_count,
              duplicates: run.duplicate_count
            }))
    };

    logger.info(payload, "Discovery smoke run completed");
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ status: "FAILED", error: message }, null, 2));
  process.exitCode = 1;
});
