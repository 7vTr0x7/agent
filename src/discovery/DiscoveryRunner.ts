import { JobDiscoveryService, DiscoveryResult } from "../jobs/services/JobDiscoveryService";
import { JobSource } from "../jobs/sources/JobSource";
import { DiscoveryMatchDispatcher, DispatchMatchResult } from "./queue/DiscoveryMatchDispatcher";
import { SourceHealthGate } from "./health/SourceHealthGate";
import { SourceRunTracker } from "./health/SourceRunTracker";
import { RegisteredSource } from "./sources/SourceRegistry";

export interface DiscoveryRunResult {
  source: string;
  discovered: DiscoveryResult;
  matching: DispatchMatchResult;
}

export const SOURCE_CONCURRENCY = 4;
const SOURCE_TIMEOUT_MS = 3 * 60 * 1000;
const PLATFORM_FEDERATION_TIMEOUT_MS = 60 * 60 * 1000;
const SOURCE_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;

export class DiscoveryRunner {
  constructor(
    private readonly discovery: JobDiscoveryService,
    private readonly health: SourceHealthGate,
    private readonly runs: SourceRunTracker,
    private readonly matchDispatcher: DiscoveryMatchDispatcher,
    private readonly sources: ReadonlyArray<RegisteredSource>
  ) {}

  async runOnce(): Promise<DiscoveryRunResult[]> {
    const results = await mapWithConcurrency(this.sources, SOURCE_CONCURRENCY, async (registered) => {
      return this.runSource(registered);
    });

    return results.flatMap((result) => result ? [result] : []);
  }

  private async runSource(registered: RegisteredSource): Promise<DiscoveryRunResult | null> {
    const { descriptor, source } = registered;
    if (!(await this.health.canRun(descriptor))) return null;

    const runId = await this.runs.start(descriptor);
    const isPlatformFederation = descriptor.id === "platform-search:federation";
    const timeoutMs = isPlatformFederation ? PLATFORM_FEDERATION_TIMEOUT_MS : SOURCE_TIMEOUT_MS;
    // Platform federation already isolates failures per platform. Retrying the
    // entire 200+ platform cycle would multiply runtime and duplicate traffic.
    const maxRetries = isPlatformFederation ? 0 : SOURCE_RETRIES;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      try {
        const discovered = await withTimeout(
          this.discovery.discover(source, controller.signal),
          timeoutMs,
          controller,
          `Discovery source ${descriptor.id} exceeded ${timeoutMs / 1000}s timeout`
        );
        const matching = await this.matchDispatcher.dispatch(discovered.insertedOpportunityIds);
        await this.runs.complete(runId, descriptor.id, "SUCCEEDED", {
          fetched: discovered.fetched,
          inserted: discovered.inserted,
          duplicates: discovered.duplicates
        });
        return { source: descriptor.id, discovered, matching };
      } catch (error) {
        lastError = error;
        if (!isTransientDiscoveryError(error) || attempt >= maxRetries) break;
        await delayWithAbort(RETRY_BASE_DELAY_MS * 2 ** attempt, controller.signal);
      } finally {
        controller.abort();
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError);
    await this.runs.recordError(runId, descriptor.id, {
      classification: isTransientDiscoveryError(lastError) ? "TRANSIENT" : "UNKNOWN",
      message
    });
    await this.runs.complete(
      runId,
      descriptor.id,
      "FAILED",
      { fetched: 0, inserted: 0, duplicates: 0 },
      message
    );
    return null;
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error(message));
      reject(new Error(message));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isTransientDiscoveryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return /timeout|timed out|temporar|econnreset|econnrefused|enotfound|eai_again|network|fetch failed|429|502|503|504/.test(message);
}

async function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  if (!items.length) return [];
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
  const output: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      output[current] = await mapper(items[current] as T);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return output;
}
