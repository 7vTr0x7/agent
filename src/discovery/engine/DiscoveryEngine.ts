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
    const registeredSources = this.registry.listRunnable();
    const results: DiscoveryResult[] = [];
    const failedSources: string[] = [];
    const skippedSources: string[] = [];

    for (const registered of registeredSources) {
      if (!(await this.healthGate.canRun(registered.descriptor))) {
        skippedSources.push(registered.descriptor.id);
        continue;
      }

      const runId = await this.runTracker.start(registered.descriptor);
      let completed = false;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await this.discoveryService.discover(registered.source);
          results.push(result);
          await this.runTracker.complete(runId, registered.descriptor.id, "SUCCEEDED", {
            fetched: result.fetched,
            inserted: result.inserted,
            duplicates: result.duplicates
          });
          completed = true;
          break;
        } catch (error) {
          const statusCode = error instanceof AppError ? error.statusCode : undefined;
          const decision = this.retryPolicy.decide(statusCode, attempt);
          const nextRetryAt = decision.retry
            ? new Date(Date.now() + decision.delayMs)
            : null;

          await this.runTracker.recordError(runId, registered.descriptor.id, {
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

          if (!decision.retry) break;
          await sleep(decision.delayMs);
        }
      }

      if (!completed) {
        failedSources.push(registered.descriptor.id);
        await this.runTracker.complete(
          runId,
          registered.descriptor.id,
          "FAILED",
          { fetched: 0, inserted: 0, duplicates: 0 },
          "Source failed after bounded retries."
        );
        await this.runTracker.markReviewRequired(registered.descriptor.id, 3);
      }
    }

    return {
      attempted: registeredSources.length,
      results,
      failedSources,
      skippedSources
    };
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
