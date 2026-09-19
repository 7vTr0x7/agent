import "dotenv/config";
import { loadConfig } from "../src/config/env";
import { Database } from "../src/database/Database";
import { MigrationRunner } from "../src/database/MigrationRunner";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { TaskQueue } from "../src/queue/TaskQueue";
import { TaskWorker } from "../src/queue/TaskWorker";
import { createDiscoveryRuntime } from "../src/discovery/createDiscoveryRuntime";
import { MATCH_JOB_TASK } from "../src/matching/MatchTask";
import { JobAgentApiServer } from "../src/api/JobAgentApiServer";

interface MatchRow { company: string; role: string; location: string | null; url: string; decision: "APPLY" | "REVIEW" | "REJECT"; score: number; reason: string; }

const DEFAULT_FAST_SOURCE_IDS = ["remoteok:json", "himalayas:json", "remotefirstjobs:react:rss"];
const logger = {
  info: (p: Record<string, unknown> | string, m?: string) => console.log(JSON.stringify({ level: "info", ...(typeof p === "string" ? { msg: p } : { ...p, msg: m }) })),
  warn: (p: Record<string, unknown> | string, m?: string) => console.warn(JSON.stringify({ level: "warn", ...(typeof p === "string" ? { msg: p } : { ...p, msg: m }) })),
  error: (p: Record<string, unknown>, m: string) => console.error(JSON.stringify({ level: "error", ...p, msg: m }))
};

function selectSources(config: ReturnType<typeof loadConfig>): string {
  const configured = (process.env.FAST_JOB_SOURCES ?? DEFAULT_FAST_SOURCE_IDS.join(",")).split(",").map(v => v.trim()).filter(Boolean);
  const all = JSON.parse(config.jobSources) as Array<Record<string, unknown>>;
  const selected = all.filter(source => configured.includes(String(source.id)));
  const missing = configured.filter(id => !selected.some(source => source.id === id));
  if (missing.length) throw new Error(`FAST_JOB_SOURCES contains unknown/unconfigured sources: ${missing.join(", ")}`);
  if (!selected.length) throw new Error("Fast job runtime requires at least one selected source.");
  return JSON.stringify(selected);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const config = loadConfig();
  const fastConfig = { ...config, jobSources: selectSources(config) };
  const database = new Database(config.databaseUrl);
  const api = new JobAgentApiServer(database, { host: "127.0.0.1", port: 0 });

  try {
    await new MigrationRunner(database).run();
    const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
    if (!profile) throw new Error("Configured candidate profile could not be resolved.");

    const queue = new TaskQueue(database);
    const runtime = createDiscoveryRuntime(database, queue, fastConfig, profile);

    const discoveryStartedAt = Date.now();
    const discoveryResults = await runtime.runner.runOnce();
    const discoveryDurationMs = Date.now() - discoveryStartedAt;

    const matchingLimitRaw = Number.parseInt(process.env.FAST_MATCHING_LIMIT ?? "50", 10);
    const matchingLimit = Number.isInteger(matchingLimitRaw) && matchingLimitRaw > 0 ? matchingLimitRaw : 50;
    const worker = new TaskWorker(queue, new Map([[MATCH_JOB_TASK, runtime.matchTaskHandler]]), {
      workerId: `fast-outcome-matching-${process.pid}`,
      pollIntervalMs: 25,
      staleRecoveryIntervalMs: 30_000,
      heartbeatIntervalMs: 2_000,
      logger
    });

    let processed = 0;
    const matchingStartedAt = Date.now();
    while (processed < matchingLimit) {
      const didProcess = await worker.runOnce([MATCH_JOB_TASK]);
      if (!didProcess) break;
      processed += 1;
    }
    worker.stop();
    const matchingDurationMs = Date.now() - matchingStartedAt;

    await api.start();
    const address = api.getAddress();
    if (!address) throw new Error("Fast outcome API failed to bind.");

    const health = await fetch(`http://${address.host}:${address.port}/healthz`);
    const summaryResponse = await fetch(`http://${address.host}:${address.port}/api/summary`);
    const summary = await summaryResponse.json() as { jobs: string; matches: string; matchApply: string; matchReview: string; matchReject: string; topMatches: MatchRow[]; };

    const counts = await database.query<{ jobs: string; observations: string; matches: string; apply: string; review: string; reject: string; pending: string }>(
      "SELECT (SELECT COUNT(*)::text FROM job_opportunities) AS jobs,(SELECT COUNT(*)::text FROM job_observations) AS observations,(SELECT COUNT(*)::text FROM match_decisions) AS matches,(SELECT COUNT(*)::text FROM match_decisions WHERE decision='APPLY') AS apply,(SELECT COUNT(*)::text FROM match_decisions WHERE decision='REVIEW') AS review,(SELECT COUNT(*)::text FROM match_decisions WHERE decision='REJECT') AS reject,(SELECT COUNT(*)::text FROM tasks WHERE task_type='MATCH_JOB' AND status IN ('PENDING','RUNNING')) AS pending"
    );
    const diagnostics = await database.query<{ source_id: string; status: string; fetched: number; inserted: number; duplicates: number; error_summary: string | null }>(
      "SELECT s.id AS source_id,sr.status,sr.fetched_count AS fetched,sr.inserted_count AS inserted,sr.duplicate_count AS duplicates,sr.error_summary FROM source_runs sr JOIN sources s ON s.id=sr.source_id ORDER BY sr.started_at ASC"
    );

    const db = counts.rows[0];
    const apiCountsAgree = summary.jobs === db.jobs &&
      summary.matchApply === db.apply &&
      summary.matchReview === db.review &&
      summary.matchReject === db.reject &&
      summary.matches === String(Number(db.apply) + Number(db.review) + Number(db.reject));

    console.log(JSON.stringify({
      status: "ok",
      mode: "fast-real-data",
      durationMs: Date.now() - startedAt,
      discoveryDurationMs,
      matchingDurationMs,
      sources: JSON.parse(fastConfig.jobSources),
      sourceCount: runtime.sourceCount,
      discoveryResults,
      diagnostics: diagnostics.rows,
      jobs: {
        discovered: discoveryResults.reduce((sum, item) => sum + item.discovered.fetched, 0),
        normalizedAndPersisted: Number(db.jobs),
        persisted: Number(db.jobs),
        observations: Number(db.observations),
        matchingTasksProcessed: processed,
        pendingMatchingTasks: Number(db.pending)
      },
      matcher: { match: Number(db.apply), review: Number(db.review), skip: Number(db.reject) },
      api: { healthStatus: health.status, summaryStatus: summaryResponse.status, countsAgreeWithDatabase: apiCountsAgree, topMatches: summary.topMatches },
      sideEffects: { gmailEnabled: process.env.GMAIL_ENABLED === "true", outboundEnabled: process.env.OUTBOUND_ENABLED === "true", applications: 0, emails: 0 }
    }, null, 2));

    if (!health.ok || !summaryResponse.ok || !apiCountsAgree) throw new Error("Fast outcome runtime API/database verification failed.");
  } finally {
    await api.stop();
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ status: "FAILED", error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
