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

export class DiscoveryRunner {
  constructor(
    private readonly discovery: JobDiscoveryService,
    private readonly health: SourceHealthGate,
    private readonly runs: SourceRunTracker,
    private readonly matchDispatcher: DiscoveryMatchDispatcher,
    private readonly sources: ReadonlyArray<RegisteredSource>
  ) {}

  async runOnce(): Promise<DiscoveryRunResult[]> {
    const results: DiscoveryRunResult[] = [];

    for (const registered of this.sources) {
      const { descriptor, source } = registered;
      if (!(await this.health.canRun(descriptor))) continue;

      const runId = await this.runs.start(descriptor);

      try {
        const discovered = await this.discovery.discover(source);
        const matching = await this.matchDispatcher.dispatch(discovered.insertedOpportunityIds);
        await this.runs.complete(runId, descriptor.id, "SUCCEEDED", {
          fetched: discovered.fetched,
          inserted: discovered.inserted,
          duplicates: discovered.duplicates
        });
        results.push({ source: descriptor.id, discovered, matching });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.runs.recordError(runId, descriptor.id, {
          classification: "UNKNOWN",
          message
        });
        await this.runs.complete(
          runId,
          descriptor.id,
          "FAILED",
          { fetched: 0, inserted: 0, duplicates: 0 },
          message
        );
      }
    }

    return results;
  }
}
