import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";
import { JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";
import {
  discoverPlatform,
  getPlatformConcurrency,
  PlatformDiscovery,
  PlatformDiscoveryDiagnostics
} from "./PlatformSearchJobSource";

/**
 * Runs every registered platform while keeping catalog-only entries truthful.
 * Catalog-only entries receive an explicit UNSUPPORTED runtime outcome instead
 * of pretending that the registry contains a scraper for them. Executable
 * entries use the existing real public-search implementation unchanged.
 */
export class CatalogAwarePlatformSearchJobSource implements JobSource {
  readonly name = "platform-search-federation";

  constructor(
    private readonly platformDiscovery: PlatformDiscovery = discoverPlatform,
    private readonly onDiagnostic: (diagnostics: PlatformDiscoveryDiagnostics) => void = () => undefined
  ) {}

  async fetchJobs(signal?: AbortSignal): Promise<Job[]> {
    const results = await mapWithConcurrency(
      JOB_PLATFORM_REGISTRY,
      getPlatformConcurrency(),
      async (platform) => {
        if (signal?.aborted) return [];

        const started = Date.now();
        const emit = (diagnostics: PlatformDiscoveryDiagnostics): void => {
          this.onDiagnostic({
            ...diagnostics,
            startedAt: diagnostics.startedAt ?? new Date(started).toISOString(),
            completedAt: diagnostics.completedAt ?? new Date().toISOString(),
            durationMs: diagnostics.durationMs ?? Math.max(0, Date.now() - started)
          });
        };

        if (platform.capability === "catalog-only") {
          emit({
            platform: platform.name,
            searchPages: 0,
            searchUrlsGenerated: 0,
            searchReturnedUrls: 0,
            uniqueUrls: 0,
            pageSuccesses: 0,
            pageFailures: 0,
            parseSuccesses: 0,
            parseFailures: 0,
            parseFailureReasons: { catalog_only: 1 },
            jobs: 0,
            errors: 0,
            finalOutcome: "UNSUPPORTED",
            extractionMode: "STATIC_ZERO_RENDER_ZERO"
          });
          return [];
        }

        try {
          return await this.platformDiscovery(platform.name, signal, emit);
        } catch (error: unknown) {
          emit({
            platform: platform.name,
            searchPages: 0,
            searchUrlsGenerated: 0,
            searchReturnedUrls: 0,
            uniqueUrls: 0,
            pageSuccesses: 0,
            pageFailures: 0,
            parseSuccesses: 0,
            parseFailures: 0,
            parseFailureReasons: { exception: 1 },
            jobs: 0,
            errors: 1,
            finalOutcome: "UNKNOWN_ERROR"
          });
          return [];
        }
      }
    );

    return results.flat();
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= items.length) return;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await worker(item, index);
      }
    }
  );
  await Promise.all(runners);
  return results;
}
