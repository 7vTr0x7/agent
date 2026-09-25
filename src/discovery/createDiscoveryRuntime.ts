import { AppConfig } from "../config/env";
import { Database } from "../database/Database";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { OllamaProvider } from "../ai/OllamaProvider";
import { TaskQueue } from "../queue/TaskQueue";
import { JobDiscoveryService } from "../jobs/services/JobDiscoveryService";
import { PostgresJobOpportunityRepository } from "../jobs/domain/PostgresJobOpportunityRepository";
import { loadJobSearchPolicy } from "../jobs/policy/loadJobSearchPolicy";
import { JobRankingService } from "../jobs/policy/JobRankingService";
import { PostgresJobRankingRepository } from "../jobs/policy/JobRankingRepository";
import { DeterministicJobMatcher } from "../matching/DeterministicJobMatcher";
import { SemanticJobMatcher } from "../matching/SemanticJobMatcher";
import { MatchPipeline } from "../matching/MatchPipeline";
import { MatchTaskDispatcher, MatchTaskHandler } from "../matching/MatchTask";
import { MatchQueueService } from "../matching/MatchQueueService";
import { PostgresMatchDecisionRepository } from "../matching/MatchDecisionRepository";
import { AdaptiveLearningService } from "../learning/AdaptiveLearningService";
import { DiscoveryMatchDispatcher } from "./queue/DiscoveryMatchDispatcher";
import { DiscoveryRunner } from "./DiscoveryRunner";
import { SourceHealthGate } from "./health/SourceHealthGate";
import { SourceRunTracker } from "./health/SourceRunTracker";
import { parseSourceConfigs } from "./sources/SourceConfig";
import { createJobSource } from "./sources/createJobSource";
import { SourceRegistry } from "./sources/SourceRegistry";
import { PlatformDiscoveryDiagnostics } from "../jobs/sources/PlatformSearchJobSource";
import { JOB_PLATFORM_REGISTRY, findJobPlatform } from "../jobs/sources/JobPlatformRegistry";

export interface DiscoveryRuntime {
  runner: DiscoveryRunner;
  matchTaskHandler: MatchTaskHandler;
  matchQueueService: MatchQueueService;
  sourceCount: number;
  flushPlatformTelemetry: () => Promise<void>;
}

type PlatformDiagnosticWithId = PlatformDiscoveryDiagnostics & { readonly platformId?: string };

export function createDiscoveryRuntime(
  database: Database,
  taskQueue: TaskQueue,
  config: AppConfig,
  candidateProfile: CandidateProfile
): DiscoveryRuntime {
  const opportunityRepository = new PostgresJobOpportunityRepository(database);
  const matchDecisions = new PostgresMatchDecisionRepository(database);
  const rankingRepository = new PostgresJobRankingRepository(database);
  const policy = loadJobSearchPolicy();
  const adaptiveLearning = new AdaptiveLearningService(database);

  const semanticMatcher = new SemanticJobMatcher(
    new OllamaProvider(config.ollama.baseUrl, config.ollama.model, config.ollama.timeoutMs),
    70,
    40,
    () => adaptiveLearning.getGuidance()
  );
  const pipeline = new MatchPipeline(
    new DeterministicJobMatcher(),
    semanticMatcher,
    matchDecisions
  );
  const ranking = new JobRankingService(policy, rankingRepository);
  const matchTaskHandler = new MatchTaskHandler(
    opportunityRepository,
    candidateProfile,
    pipeline,
    ranking,
    taskQueue,
    config,
    csvEnvironment("JOB_EXCLUDED_COMPANIES")
  );

  const platformTelemetryWrites: Promise<unknown>[] = [];
  const registry = new SourceRegistry();
  for (const sourceConfig of parseSourceConfigs(config.jobSources)) {
    const adapterSource = createJobSource(
      sourceConfig,
      sourceConfig.name.toLowerCase() === "platform-search"
        ? (diagnostics: PlatformDiscoveryDiagnostics) => {
            const diagnostic = diagnostics as PlatformDiagnosticWithId;
            const platform = diagnostic.platformId
              ? JOB_PLATFORM_REGISTRY.find((entry) => entry.id === diagnostic.platformId)
              : findJobPlatform(diagnostics.platform);
            const write = database.query(
              `INSERT INTO platform_discovery_runs (
                 platform_id, platform_name, capability, outcome, extraction_mode,
                 started_at, completed_at, search_pages, search_urls_generated,
                 search_returned_urls, unique_urls, fetched, normalized, inserted,
                 duplicates, timeouts, errors, duration_ms, error_detail
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
              [
                diagnostic.platformId ?? platform?.id ?? `unknown-${diagnostics.platform.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
                diagnostics.platform,
                platform?.capability ?? "unavailable",
                diagnostics.finalOutcome ?? "UNKNOWN",
                diagnostics.extractionMode ?? null,
                diagnostics.startedAt ?? new Date().toISOString(),
                diagnostics.completedAt ?? new Date().toISOString(),
                diagnostics.searchPages,
                diagnostics.searchUrlsGenerated ?? 0,
                diagnostics.searchReturnedUrls,
                diagnostics.uniqueUrls,
                diagnostics.jobs,
                diagnostics.jobs,
                0,
                diagnostics.duplicates ?? 0,
                diagnostics.timeouts ?? 0,
                diagnostics.errors ?? 0,
                diagnostics.durationMs ?? 0,
                Object.entries(diagnostics.parseFailureReasons).map(([reason, count]) => `${reason}:${count}`).join(", ") || null
              ]
            );
            platformTelemetryWrites.push(write);
            void write.catch((error: unknown) => {
              console.error("platform telemetry persistence failed:", error instanceof Error ? error.message : String(error));
            });
          }
        : undefined
    );
    const source = {
      name: sourceConfig.id,
      fetchJobs: (signal?: AbortSignal) => adapterSource.fetchJobs(signal)
        .then((jobs) => jobs.map((job) => ({ ...job, source: job.source?.trim() || sourceConfig.id })))
    };
    registry.register({
      source,
      descriptor: {
        id: sourceConfig.id,
        name: sourceConfig.name,
        type: sourceConfig.type,
        policy: {
          status: sourceConfig.status ?? "APPROVED",
          allowedSourceTypes: [sourceConfig.type]
        }
      }
    });
  }

  const flushPlatformTelemetry = async (): Promise<void> => {
    const writes = platformTelemetryWrites.splice(0, platformTelemetryWrites.length);
    if (writes.length === 0) return;
    const settled = await Promise.allSettled(writes);
    const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (rejected.length > 0) {
      const first = rejected[0]?.reason;
      throw new Error(`Platform telemetry persistence failed for ${rejected.length} write(s): ${first instanceof Error ? first.message : String(first)}`);
    }
  };

  const matchDispatcher = new DiscoveryMatchDispatcher(
    opportunityRepository,
    new MatchTaskDispatcher(taskQueue),
    policy,
    candidateProfile.id
  );
  const matchQueueService = new MatchQueueService(
    database,
    new MatchTaskDispatcher(taskQueue)
  );

  const runner = new DiscoveryRunner(
    new JobDiscoveryService(database),
    new SourceHealthGate(database),
    new SourceRunTracker(database),
    matchDispatcher,
    registry.listRunnable()
  );

  return {
    runner,
    matchTaskHandler,
    matchQueueService,
    sourceCount: registry.listRunnable().length,
    flushPlatformTelemetry
  };
}

function csvEnvironment(name: string): string[] {
  return (process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}