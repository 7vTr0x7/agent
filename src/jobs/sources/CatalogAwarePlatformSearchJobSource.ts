import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";
import { JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";
import {
  discoverPlatform,
  getPlatformConcurrency,
  PlatformDiscovery,
  PlatformDiscoveryDiagnostics
} from "./PlatformSearchJobSource";

const DEFAULT_PLATFORM_ITEM_TIMEOUT_MS = 30_000;
type PlatformDiagnosticWithId = PlatformDiscoveryDiagnostics & { readonly platformId: string };

/**
 * Runs every registered platform while keeping catalog/configuration state truthful.
 * Catalog-only entries receive UNSUPPORTED and configurable adapters without a
 * configured adapter receive CONFIGURATION_ERROR. Only executable adapters use
 * the existing real public-search implementation. A hard per-platform timeout
 * prevents a renderer/provider from keeping the whole federation worker alive.
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
        const startedAt = new Date(started).toISOString();
        let suppressLateDiagnostics = false;
        const emit = (diagnostics: PlatformDiscoveryDiagnostics): void => {
          if (suppressLateDiagnostics) return;
          const diagnostic: PlatformDiagnosticWithId = {
            ...diagnostics,
            platformId: platform.id,
            startedAt: diagnostics.startedAt ?? startedAt,
            completedAt: diagnostics.completedAt ?? new Date().toISOString(),
            durationMs: diagnostics.durationMs ?? Math.max(0, Date.now() - started)
          };
          this.onDiagnostic(diagnostic);
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

        if (platform.capability === "configurable-adapter") {
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
            parseFailureReasons: { configuration_required: 1 },
            jobs: 0,
            errors: 0,
            finalOutcome: "CONFIGURATION_ERROR",
            extractionMode: "STATIC_ZERO_RENDER_ZERO"
          });
          return [];
        }

        const timeoutMs = readPlatformItemTimeoutMs();
        const platformController = new AbortController();
        const abortFromParent = (): void => platformController.abort(signal?.reason);
        if (signal?.aborted) return [];
        signal?.addEventListener("abort", abortFromParent, { once: true });
        const timer = setTimeout(() => {
          platformController.abort(new Error(`Platform ${platform.name} exceeded ${timeoutMs}ms timeout`));
        }, timeoutMs);

        const discoveryPromise = this.platformDiscovery(platform.name, platformController.signal, emit);
        try {
          const result = await Promise.race([
            discoveryPromise.then((jobs) => ({ kind: "complete" as const, jobs })),
            new Promise<{ kind: "timeout" }>((resolve) => setTimeout(() => resolve({ kind: "timeout" }), timeoutMs))
          ]);

          if (result.kind === "timeout") {
            suppressLateDiagnostics = true;
            platformController.abort(new Error(`Platform ${platform.name} exceeded ${timeoutMs}ms timeout`));
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
              parseFailureReasons: { platform_timeout: 1 },
              jobs: 0,
              errors: 0,
              timeouts: 1,
              finalOutcome: "TIMEOUT"
            });
            void discoveryPromise.catch(() => undefined);
            return [];
          }

          return result.jobs;
        } catch {
          suppressLateDiagnostics = true;
          const timedOut = platformController.signal.aborted && !signal?.aborted;
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
            parseFailureReasons: { [timedOut ? "platform_timeout" : "exception"]: 1 },
            jobs: 0,
            errors: timedOut ? 0 : 1,
            timeouts: timedOut ? 1 : 0,
            finalOutcome: timedOut ? "TIMEOUT" : "UNKNOWN_ERROR"
          });
          return [];
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abortFromParent);
        }
      }
    );

    return results.flat();
  }
}

function readPlatformItemTimeoutMs(): number {
  const raw = process.env.PLATFORM_ITEM_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_PLATFORM_ITEM_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1_000) throw new Error("PLATFORM_ITEM_TIMEOUT_MS must be an integer >= 1000");
  return parsed;
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
