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
import { PostgresMatchDecisionRepository } from "../matching/MatchDecisionRepository";
import { DiscoveryMatchDispatcher } from "./queue/DiscoveryMatchDispatcher";
import { DiscoveryRunner } from "./DiscoveryRunner";
import { SourceHealthGate } from "./health/SourceHealthGate";
import { SourceRunTracker } from "./health/SourceRunTracker";
import { parseSourceConfigs } from "./sources/SourceConfig";
import { createJobSource } from "./sources/createJobSource";
import { SourceRegistry } from "./sources/SourceRegistry";

export interface DiscoveryRuntime {
  runner: DiscoveryRunner;
  matchTaskHandler: MatchTaskHandler;
  sourceCount: number;
}

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

  const semanticMatcher = new SemanticJobMatcher(
    new OllamaProvider(config.ollama.baseUrl, config.ollama.model, config.ollama.timeoutMs)
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
    ranking
  );

  const registry = new SourceRegistry();
  for (const sourceConfig of parseSourceConfigs(config.jobSources)) {
    const source = createJobSource(sourceConfig);
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

  const matchDispatcher = new DiscoveryMatchDispatcher(
    opportunityRepository,
    new MatchTaskDispatcher(taskQueue),
    policy,
    candidateProfile.id
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
    sourceCount: registry.listRunnable().length
  };
}
