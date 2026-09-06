import { AppError } from "../../shared/errors/AppError";
import {
  JobDiscoveryService,
  DiscoveryResult
} from "../../jobs/services/JobDiscoveryService";
import {
  DiscoveryMatchDispatcher,
  DispatchMatchResult
} from "../queue/DiscoveryMatchDispatcher";
import { RetryPolicy } from "../health/RetryPolicy";
import { SourceHealthGate } from "../health/SourceHealthGate";
import { SourceRunTracker } from "../health/SourceRunTracker";
import { SourceRegistry } from "../sources/SourceRegistry";

export interface DiscoveryEngineResult {
  attempted: number;
  results: DiscoveryResult[];
  failedSources: string[];
  skippedSources: string[];
  matchDispatch: DispatchMatchResult;
}

export class DiscoveryEngine {
  constructor(
    private readonly registry: SourceRegistry,
    private readonly discoveryService: JobDiscoveryService,
    private readonly runTracker: SourceRunTracker,
    private readonly healthGate: SourceHealthGate,
    private readonly retryPolicy = new RetryPolicy(),
    private readonly matchDispatcher: DiscoveryMatchDispatcher | null = null
  ) {}

  async run(): Promise<DiscoveryEngineResult> {
    const runnableSources = this.registry.listRunnable();
    const results: DiscoveryResult[] = [];
    const failedSources: string[] = [];
    const skippedSources: string[] = [];
    const matchDispatch = emptyDispatchResult();

    for (const registered of runnableSources) {
      const result = await this.runSource(registered.descriptor.id);

      if (result.status === "SKIPPED") {
        skippedSources.push(registered.descriptor.id);
      } else if (result.status === "FAILED") {
        failedSources.push(registered.descriptor.id);
      } else if (result.discovery) {
        results.push(result.discovery);
        mergeDispatchResult(matchDispatch, result.matchDispatch);
      }
    }

    return {
      attempted: runnableSources.length,
      results,
      failedSources,
      skippedSources,
      matchDispatch
    };
  }

  async runSource(sourceId: string): Promise<RunSourceResult> {
    const registered = this.registry.get(sourceId);
    if (
      !registered ||
      !this.registry.listRunnable().some(({ descriptor }) => descriptor.id === sourceId)
    ) {
      return { status: "SKIPPED" };
    }

    if (!(await this.healthGate.canRun(registered.descriptor))) {
      return { status: "SKIPPED" };
    }

    const runId = await this.runTracker.start(registered.descriptor);

    for (let attempt = 1; attempt <= this.retryPolicy.attempts; attempt++) {
      try {
        const result = await this.discoveryService.discover(registered.source);
        const matchDispatch = this.matchDispatcher
          ? await this.matchDispatcher.dispatch(result.insertedOpportunityIds)
          : emptyDispatchResult();

        await this.runTracker.complete(runId, sourceId, "SUCCEEDED", {
          fetched: result.fetched,
          inserted: result.inserted,
          duplicates: result.duplicates
        });

        return {
          status: "SUCCEEDED",
          discovery: result,
          matchDispatch
        };
      } catch (error) {
        const statusCode = error instanceof AppError ? error.statusCode : undefined;
        const decision = this.retryPolicy.decide(statusCode, attempt);
        const nextRetryAt = decision.retry
          ? new Date(Date.now() + decision.delayMs)
          : null;

        await this.runTracker.recordError(runId, sourceId, {
          classification:
            error instanceof AppError && error.code === "JOB_SOURCE_INVALID_DATA"
              ? "INVALID_DATA"
              : decision.classification,
          message: error instanceof Error ? error.message : String(error),
          attempt,
          statusCode,
          nextRetryAt,
          metadata: error instanceof AppError ? { code: error.code } : undefined
        });

        if (decision.classification === "RATE_LIMIT" && nextRetryAt) {
          await this.runTracker.applyCooldown(sourceId, nextRetryAt);
        }

        if (decision.retry) {
          await sleep(decision.delayMs);
        } else {
          break;
        }
      }
    }

    await this.runTracker.complete(
      runId,
      sourceId,
      "FAILED",
      { fetched: 0, inserted: 0, duplicates: 0 },
      "Source failed after bounded retries."
    );
    await this.runTracker.markReviewRequired(sourceId, this.retryPolicy.attempts);

    return { status: "FAILED" };
  }
}

export type RunSourceStatus = "SUCCEEDED" | "FAILED" | "SKIPPED";

export interface RunSourceResult {
  status: RunSourceStatus;
  discovery?: DiscoveryResult;
  matchDispatch?: DispatchMatchResult;
}

function emptyDispatchResult(): DispatchMatchResult {
  return { enqueued: 0, rejected: 0, missing: 0 };
}

function mergeDispatchResult(
  target: DispatchMatchResult,
  source: DispatchMatchResult | undefined
): void {
  if (!source) return;
  target.enqueued += source.enqueued;
  target.rejected += source.rejected;
  target.missing += source.missing;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
