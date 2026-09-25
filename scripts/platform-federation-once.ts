import "dotenv/config";
import pino from "pino";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { TaskQueue } from "../src/queue/TaskQueue";
import { createDiscoveryRuntime } from "../src/discovery/createDiscoveryRuntime";
import { JOB_PLATFORM_REGISTRY } from "../src/jobs/sources/JobPlatformRegistry";

async function main(): Promise<void> {
  process.env.DISCOVERY_SOURCE_TIMEOUT_MS = process.env.PLATFORM_FEDERATION_SOURCE_TIMEOUT_MS ?? process.env.DISCOVERY_SOURCE_TIMEOUT_MS ?? "30000";
  const config = loadConfig();
  const sources = JSON.parse(config.jobSources) as Array<{ name?: string; id?: string; status?: string }>;
  const platformSource = sources.find((source) => source.name?.trim().toLowerCase() === "platform-search");
  if (!platformSource) throw new Error("JOB_SOURCES must contain the platform-search source before a full federation run.");
  if (platformSource.status === "DISABLED") throw new Error("The platform-search source is DISABLED; refusing to claim federation coverage.");

  const allPlatforms = JOB_PLATFORM_REGISTRY;
  const logger = pino({ level: config.logLevel });
  const database = new Database(config.databaseUrl);

  try {
    await new MigrationRunner(database).run();
    const candidateProfiles = ConfiguredCandidateProfileResolver.fromEnvironment();
    const candidateProfile = await candidateProfiles.getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!candidateProfile) throw new Error("Configured candidate profile could not be resolved.");

    const federationConfig = { ...config, jobSources: JSON.stringify([platformSource]) };
    const runtime = createDiscoveryRuntime(database, new TaskQueue(database), federationConfig, candidateProfile);
    if (runtime.sourceCount !== 1) throw new Error(`Federation runtime must contain exactly one platform source; got ${runtime.sourceCount}.`);

    const before = await database.query<{ jobs: string; matches: string }>(
      `SELECT (SELECT COUNT(*)::text FROM job_opportunities) AS jobs,
              (SELECT COUNT(DISTINCT job_opportunity_id)::text FROM match_decisions) AS matches`
    );

    const startedAt = new Date().toISOString();
    const results = await runtime.runner.runOnce();
    await runtime.flushPlatformTelemetry();
    const completedAt = new Date().toISOString();

    const after = await database.query<{ jobs: string; matches: string }>(
      `SELECT (SELECT COUNT(*)::text FROM job_opportunities) AS jobs,
              (SELECT COUNT(DISTINCT job_opportunity_id)::text FROM match_decisions) AS matches`
    );

    const platformIds = new Set(allPlatforms.map((platform) => platform.id));
    const readLatest = async () => database.query<{
      platform_id: string; platform_name: string; capability: string; outcome: string;
      fetched: string; normalized: string | null; inserted: string; duplicates: string;
      duration_ms: string; completed_at: string; error_detail: string | null;
    }>(
      `SELECT DISTINCT ON (platform_id)
         platform_id, platform_name, capability, outcome, fetched, normalized,
         inserted, duplicates, duration_ms, completed_at, error_detail
       FROM platform_discovery_runs
       ORDER BY platform_id, completed_at DESC, id DESC`
    );

    const timeoutMs = Math.max(30_000, Math.min(300_000, Number(process.env.PLATFORM_TELEMETRY_DRAIN_TIMEOUT_MS) || 300_000));
    const deadline = Date.now() + timeoutMs;
    let latest = await readLatest();
    while (new Set(latest.rows.filter((row) => platformIds.has(row.platform_id)).map((row) => row.platform_id)).size < allPlatforms.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      latest = await readLatest();
    }

    const executed = latest.rows.filter((row) => platformIds.has(row.platform_id));
    const executedIds = new Set(executed.map((row) => row.platform_id));
    const notExecuted = allPlatforms.filter((platform) => !executedIds.has(platform.id)).map((platform) => platform.name);

    const payload = {
      status: notExecuted.length === 0 ? "FULL_PLATFORM_CATALOG_COMPLETED" : "PLATFORM_CATALOG_INCOMPLETE",
      startedAt,
      completedAt,
      registry: {
        total: allPlatforms.length,
        activeAdapters: allPlatforms.filter((p) => p.capability === "active-adapter").length,
        configurableAdapters: allPlatforms.filter((p) => p.capability === "configurable-adapter").length,
        catalogOnly: allPlatforms.filter((p) => p.capability === "catalog-only").length,
        executable: allPlatforms.filter((p) => p.capability !== "catalog-only").length
      },
      runtime: {
        sourceCount: runtime.sourceCount,
        resultCount: results.length,
        before: before.rows[0] ?? null,
        after: after.rows[0] ?? null
      },
      coverage: {
        attempted: executed.length,
        missing: notExecuted.length,
        missingPlatforms: notExecuted,
        outcomes: executed
      }
    };

    logger.info(payload, "Full registered platform catalog run completed");
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
