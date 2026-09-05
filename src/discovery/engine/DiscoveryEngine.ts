import { AppError } from "../../shared/errors/AppError";
import { JobDiscoveryService, DiscoveryResult } from "../../jobs/services/JobDiscoveryService";
import { RetryPolicy } from "../health/RetryPolicy";
import { SourceHealthGate } from "../health/SourceHealthGate";
import { SourceRunTracker } from "../health/SourceRunTracker";
import { SourceRegistry } from "../sources/SourceRegistry";

export interface DiscoveryEngineResult {
  attempted: number;
  results: DiscoveryResult[];
  failedSources: string[];
  skippedSources: string[];
}

export class DiscoveryEngine {
  constructor(
    private readonly registry: SourceRegistry,
    private readonly discoveryService: JobDiscoveryService,
    private readonly runTracker: SourceRunTracker,
    private readonly healthGate: SourceHealthGate,
    private readonly retryPolicy = new RetryPolicy()
  ) {}

  async run(): Promise<DiscoveryEngineResult> {
    const runnableSources = this.registry.listRunnable();
    const results: DiscoveryResult[] = [];
    const failedSources: string[] = [];
    const skippedSources: string[] = [];

    for (const registered of runnableSources) {
      const result = await this.runSource(registered.descriptor.id);

      if (result.status === "SKIPPED") {
        skippedSources.push(registered.descriptor.id);
      } else if (result.status === "FAILED") {
        failedSources.push(registered.descriptor.id);
      } else if (result.discovery) {
        results.push(result.discovery);
      }
    }

    return {
      attempted: runnableSources.length,
      results,
      failedSources,
      skippedSources
    };
  }

  async runSource(sourceId: string): Promise<RunSourceResult> {
    const registered = this.registry.get(sourceId);
    if (!registered || !this.registry.listRunnable().some(({ descriptor }) => descriptor.id === sourceId)) {
      return { status: "SKIPPED" };
    }

    if (!(await this.healthGate.canRun(registered.descriptor))) {
      return { status: "SKIPPED" };
    }

    const runId = await this.runTracker.start(registered.descriptor);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await this.discoveryService.discover(registered.source);
        await this.runTracker.complete(runId, sourceId, "SUCCEEDED", {
          fetched: result.fetched,
          inserted: result.inserted,
          duplicates: result.duplicates
        });
        return { status: "SUCCEEDED", discovery: result };
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
    await this.runTracker.markReviewRequired(sourceId, 3);

    return { status: "FAILED" };
  }
}

export type RunSourceStatus = "SUCCEEDED" | "FAILED" | "SKIPPED";

export interface RunSourceResult {
  status: RunSourceStatus;
  discovery?: DiscoveryResult;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
