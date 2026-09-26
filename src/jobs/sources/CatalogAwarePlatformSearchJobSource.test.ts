import { CatalogAwarePlatformSearchJobSource } from "./CatalogAwarePlatformSearchJobSource";

const registryModule = jest.requireActual("./JobPlatformRegistry") as typeof import("./JobPlatformRegistry");

describe("CatalogAwarePlatformSearchJobSource", () => {
  it("accounts for catalog-only and configurable platforms without invoking public search", async () => {
    const diagnostics: Array<{ platform: string; finalOutcome?: string }> = [];
    const discover = jest.fn(async () => []);
    const source = new CatalogAwarePlatformSearchJobSource(discover, (value) => {
      diagnostics.push({ platform: value.platform, finalOutcome: value.finalOutcome });
    });

    await source.fetchJobs();

    const registry = registryModule.JOB_PLATFORM_REGISTRY;
    const catalogOnly = registry.filter((platform) => platform.capability === "catalog-only");
    const configurable = registry.filter((platform) => platform.capability === "configurable-adapter");
    const executable = registry.filter((platform) => platform.capability !== "catalog-only" && platform.capability !== "configurable-adapter");

    expect(diagnostics).toHaveLength(registry.length);
    expect(diagnostics.filter((value) => value.finalOutcome === "UNSUPPORTED")).toHaveLength(catalogOnly.length);
    expect(diagnostics.filter((value) => value.finalOutcome === "CONFIGURATION_ERROR")).toHaveLength(configurable.length);
    expect(discover).toHaveBeenCalledTimes(executable.length);
  });

  it("terminates a non-resolving platform invocation and continues the bounded worker pool", async () => {
    const original = process.env.PLATFORM_ITEM_TIMEOUT_MS;
    process.env.PLATFORM_ITEM_TIMEOUT_MS = "1000";
    try {
      const diagnostics: Array<{ platform: string; finalOutcome?: string }> = [];
      const discover = jest.fn(async (platform: string) => {
        if (platform === registryModule.JOB_PLATFORM_REGISTRY.find((entry) => entry.capability === "active-adapter")?.name) {
          return await new Promise<never>(() => undefined);
        }
        return [];
      });
      const source = new CatalogAwarePlatformSearchJobSource(discover, (value) => {
        diagnostics.push({ platform: value.platform, finalOutcome: value.finalOutcome });
      });

      await expect(source.fetchJobs()).resolves.toEqual([]);

      const registry = registryModule.JOB_PLATFORM_REGISTRY;
      const executable = registry.filter((platform) => platform.capability !== "catalog-only" && platform.capability !== "configurable-adapter");
      expect(discover).toHaveBeenCalledTimes(executable.length);
      expect(diagnostics).toHaveLength(registry.length);
      expect(diagnostics.some((value) => value.finalOutcome === "TIMEOUT")).toBe(true);
      expect(diagnostics.filter((value) => value.finalOutcome === "UNSUPPORTED")).toHaveLength(
        registry.filter((platform) => platform.capability === "catalog-only").length
      );
    } finally {
      if (original === undefined) delete process.env.PLATFORM_ITEM_TIMEOUT_MS;
      else process.env.PLATFORM_ITEM_TIMEOUT_MS = original;
    }
  });
});
