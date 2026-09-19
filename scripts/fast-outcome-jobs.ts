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
import { DISCOVER_RECRUITERS_TASK } from "../src/recruiters/RecruiterDiscoveryTask";
import { RecruiterDiscoveryRepository } from "../src/recruiters/RecruiterDiscoveryRepository";
import { PersistentRecruiterDiscoveryService } from "../src/recruiters/PersistentRecruiterDiscoveryService";
import { RecruiterDiscoveryTaskHandler } from "../src/recruiters/RecruiterDiscoveryTaskHandler";
import { createRecruiterDiscoveryProvider } from "../src/recruiters/createRecruiterDiscoveryProvider";
import { PostgresJobOpportunityRepository } from "../src/jobs/domain/PostgresJobOpportunityRepository";
import { DeterministicJobMatcher } from "../src/matching/DeterministicJobMatcher";

interface MatchRow {
  company: string;
  role: string;
  location: string | null;
  url: string;
  decision: "APPLY" | "REVIEW" | "REJECT";
  score: number;
  reason: string;
}

const logger = {
  info: (payloadOrMessage: Record<string, unknown> | string, message?: string) => {
    console.log(JSON.stringify({
      level: "info",
      ...(typeof payloadOrMessage === "string" ? { msg: payloadOrMessage } : { ...payloadOrMessage, msg: message })
    }));
  },
  warn: (payloadOrMessage: Record<string, unknown> | string, message?: string) => {
    console.warn(JSON.stringify({
      level: "warn",
      ...(typeof payloadOrMessage === "string" ? { msg: payloadOrMessage } : { ...payloadOrMessage, msg: message })
    }));
  },
  error: (payload: Record<string, unknown>, message: string) => {
    console.error(JSON.stringify({ level: "error", ...payload, msg: message }));
  }
};

async function main(): Promise<void> {
  const startedAt = Date.now();
  const config = loadConfig();
  const database = new Database(config.databaseUrl);
  const api = new JobAgentApiServer(database, { host: "127.0.0.1", port: 0 });

  try {
    await new MigrationRunner(database).run();

    const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(
      process.env.CANDIDATE_PROFILE_ID ?? ""
    );
    if (!profile) throw new Error("Configured candidate profile could not be resolved.");

    const queue = new TaskQueue(database);
    const baseConfig = loadConfig();
    const recruiterDiscoveryEnabled = process.env.RECRUITER_OUTREACH_ENABLED === "true";
    const runtimeConfig = {
      ...baseConfig,
      recruiterOutreach: {
        ...baseConfig.recruiterOutreach,
        enabled: recruiterDiscoveryEnabled
      }
    };
    const fastSourceIds = (process.env.FAST_JOB_SOURCE_IDS ?? "remoteok:json,himalayas:react:india:json,himalayas:nextjs:india:json,himalayas:frontend:india:json,remotefirstjobs:react:rss,remotefirstjobs:software:rss,weworkremotely:rss,realworkfromanywhere:frontend:rss,realworkfromanywhere:fullstack:rss").split(",").map((value) => value.trim()).filter(Boolean);
    const configuredSources = JSON.parse(baseConfig.jobSources) as Array<{ id?: string }>;
    const selectedSources = configuredSources.filter((source) => source.id && fastSourceIds.includes(source.id));
    if (selectedSources.length === 0) throw new Error(`FAST_JOB_SOURCE_IDS selected no configured sources: ${fastSourceIds.join(",")}`);
    const runtime = createDiscoveryRuntime(database, queue, {
      ...runtimeConfig,
      jobSources: JSON.stringify(selectedSources)
    }, profile);

    const discoveryStartedAt = Date.now();
    const discoveryResults = await runtime.runner.runOnce();
    const discoveryDurationMs = Date.now() - discoveryStartedAt;

    const matchingLimitRaw = Number.parseInt(process.env.FAST_MATCHING_LIMIT ?? "100", 10);
    const matchingLimit = Number.isInteger(matchingLimitRaw) && matchingLimitRaw > 0 ? matchingLimitRaw : 100;
    const recruiterRepository = recruiterDiscoveryEnabled ? new RecruiterDiscoveryRepository(database) : undefined;
    const recruiterDiscoveryHandler = recruiterDiscoveryEnabled && recruiterRepository
      ? new RecruiterDiscoveryTaskHandler(
          new PersistentRecruiterDiscoveryService({
            provider: createRecruiterDiscoveryProvider({ provider: config.recruiterOutreach.discoveryProvider }),
            repository: recruiterRepository,
            minConfidence: config.recruiterOutreach.minConfidence,
            requireVerifiedEmail: config.recruiterOutreach.requireVerifiedEmail
          }),
          Math.max(1, config.recruiterOutreach.maxContactsPerApplication),
          undefined,
          logger
        )
      : undefined;

    // The fast runtime is deliberately bounded. Discovery enqueues MATCH_JOB tasks before
    // decisions exist, so a FIFO slice can miss the real positive matches entirely. Re-score
    // pending tasks with the existing deterministic matcher only to prioritize scheduling;
    // the normal MatchTaskHandler remains the sole persistence/semantic/ranking path.
    const opportunityRepository = new PostgresJobOpportunityRepository(database);
    const deterministicMatcher = new DeterministicJobMatcher();
    const pendingMatchTasks = await database.query<{ id: string; jobOpportunityId: string }>(
      `SELECT id, payload->>'jobOpportunityId' AS "jobOpportunityId"
       FROM tasks
       WHERE task_type = $1 AND status = 'PENDING'
       ORDER BY priority DESC, available_at ASC, created_at ASC`,
      [MATCH_JOB_TASK]
    );
    let prioritizedPositiveMatches = 0;
    for (const task of pendingMatchTasks.rows) {
      const job = await opportunityRepository.findById(task.jobOpportunityId);
      if (!job) continue;
      const preview = deterministicMatcher.evaluate(job, profile);
      const priority =
        preview.decision === "APPLY" ? 200 + preview.matchScore :
        preview.decision === "REVIEW" ? 100 + preview.matchScore :
        0;
      if (priority > 0) prioritizedPositiveMatches += 1;
      await database.query(
        `UPDATE tasks SET priority = $2, updated_at = NOW()
         WHERE id = $1 AND status = 'PENDING'`,
        [task.id, priority]
      );
    }
    logger.info({ prioritizedPositiveMatches, pendingMatchTasks: pendingMatchTasks.rows.length }, "Prioritized bounded match tasks using the existing deterministic matcher.");

    const handlers = new Map<string, any>([[MATCH_JOB_TASK, runtime.matchTaskHandler]]);
    if (recruiterDiscoveryHandler) handlers.set(DISCOVER_RECRUITERS_TASK, recruiterDiscoveryHandler);
    const worker = new TaskWorker(
      queue,
      handlers,
      {
        workerId: `fast-outcome-matching-${process.pid}`,
        pollIntervalMs: 25,
        staleRecoveryIntervalMs: 30_000,
        heartbeatIntervalMs: 2_000,
        logger
      }
    );

    let processed = 0;
    const matchingStartedAt = Date.now();
    while (processed < matchingLimit) {
      const didProcess = await worker.runOnce([MATCH_JOB_TASK]);
      if (!didProcess) break;
      processed += 1;
    }
    const matchingDurationMs = Date.now() - matchingStartedAt;

    const recruiterLimitRaw = Number.parseInt(process.env.FAST_RECRUITER_TASK_LIMIT ?? "10", 10);
    const recruiterLimit = Number.isInteger(recruiterLimitRaw) && recruiterLimitRaw > 0 ? recruiterLimitRaw : 10;
    let recruiterTasksProcessed = 0;
    const recruiterStartedAt = Date.now();
    if (recruiterDiscoveryHandler) {
      while (recruiterTasksProcessed < recruiterLimit) {
        const didProcess = await worker.runOnce([DISCOVER_RECRUITERS_TASK]);
        if (!didProcess) break;
        recruiterTasksProcessed += 1;
      }
    }
    worker.stop();
    const recruiterDurationMs = Date.now() - recruiterStartedAt;

    await api.start();
    const address = api.getAddress();
    if (!address) throw new Error("Fast outcome API failed to bind.");

    const health = await fetch(`http://${address.host}:${address.port}/healthz`);
    const summaryResponse = await fetch(`http://${address.host}:${address.port}/api/summary`);
    const summary = await summaryResponse.json() as {
      jobs: string;
      matches: string;
      matchApply: string;
      matchReview: string;
      matchReject: string;
      topMatches: MatchRow[];
    };

    const counts = await database.query<{ jobs: string; observations: string; matches: string; apply: string; review: string; reject: string; pending: string }>(
      `SELECT
        (SELECT COUNT(*)::text FROM job_opportunities) AS jobs,
        (SELECT COUNT(*)::text FROM job_observations) AS observations,
        (SELECT COUNT(*)::text FROM match_decisions) AS matches,
        (SELECT COUNT(*)::text FROM match_decisions WHERE decision='APPLY') AS apply,
        (SELECT COUNT(*)::text FROM match_decisions WHERE decision='REVIEW') AS review,
        (SELECT COUNT(*)::text FROM match_decisions WHERE decision='REJECT') AS reject,
        (SELECT COUNT(*)::text FROM tasks WHERE task_type='MATCH_JOB' AND status IN ('PENDING','RUNNING')) AS pending`
    );

    const diagnostics = await database.query<{ source_id: string; status: string; fetched: number; inserted: number; duplicates: number; error_summary: string | null }>(
      `SELECT s.id AS source_id, sr.status, sr.fetched_count AS fetched, sr.inserted_count AS inserted,
              sr.duplicate_count AS duplicates, sr.error_summary
       FROM source_runs sr JOIN sources s ON s.id=sr.source_id
       ORDER BY sr.started_at ASC`
    );

    const db = counts.rows[0];
    const apiCountsAgree =
      summary.jobs === db.jobs &&
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
      recruiterDurationMs,
      sourceCount: runtime.sourceCount,
      discoveryResults,
      diagnostics: diagnostics.rows,
      jobs: {
        discovered: discoveryResults.reduce((sum, item) => sum + item.discovered.fetched, 0),
        persisted: db.jobs,
        observations: db.observations,
        matchingTasksProcessed: processed,
        pendingMatchingTasks: db.pending,
        recruiterTasksProcessed,
        recruiterTasksPending: await database.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM tasks WHERE task_type='DISCOVER_RECRUITERS' AND status IN ('PENDING','RUNNING')`
        ).then((result) => result.rows[0]?.count ?? "0")
      },
      matcher: {
        match: db.apply,
        review: db.review,
        skip: db.reject
      },
      api: {
        healthStatus: health.status,
        summaryStatus: summaryResponse.status,
        countsAgreeWithDatabase: apiCountsAgree,
        topMatches: summary.topMatches
      },
      sideEffects: {
        gmailEnabled: process.env.GMAIL_ENABLED === "true",
        outboundEnabled: process.env.OUTBOUND_ENABLED === "true",
        applications: 0,
        emails: 0
      }
    }, null, 2));

    if (!health.ok || !summaryResponse.ok || !apiCountsAgree) {
      throw new Error("Fast outcome runtime API/database verification failed.");
    }
  } finally {
    await api.stop();
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    status: "FAILED",
    error: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exitCode = 1;
});
