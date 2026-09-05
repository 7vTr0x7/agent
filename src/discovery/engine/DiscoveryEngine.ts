import { JobDiscoveryService, DiscoveryResult } from "../../jobs/services/JobDiscoveryService";
import { SourceRegistry } from "../sources/SourceRegistry";

export interface DiscoveryEngineResult {
  attempted: number;
  results: DiscoveryResult[];
}

export class DiscoveryEngine {
  constructor(
    private readonly registry: SourceRegistry,
    private readonly discoveryService: JobDiscoveryService
  ) {}

  async run(): Promise<DiscoveryEngineResult> {
    const runnableSources = this.registry.listRunnable();
    const results: DiscoveryResult[] = [];

    for (const { source } of runnableSources) {
      results.push(await this.discoveryService.discover(source));
    }

    return {
      attempted: runnableSources.length,
      results
    };
  }
}
