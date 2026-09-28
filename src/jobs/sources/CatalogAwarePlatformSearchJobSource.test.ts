import { CatalogAwarePlatformSearchJobSource } from "./CatalogAwarePlatformSearchJobSource";

const registryModule = jest.requireActual("./JobPlatformRegistry") as typeof import("./JobPlatformRegistry");

describe("CatalogAwarePlatformSearchJobSource", () => {
  it("attempts every registered platform and does not silently skip fallback-capable entries", async () => {
    const diagnostics: Array<{ platform: string; finalOutcome?: string }> = [];
    const discover = jest.fn(async () => []);
    const source = new CatalogAwarePlatformSearchJobSource(discover, (value) => {
      diagnostics.push({ platform: value.platform, finalOutcome: value.finalOutcome });
    });

    await source.fetchJobs();

    const registry = registryModule.JOB_PLATFORM_REGISTRY;
    expect(registry).toHaveLength(200);
    expect(diagnostics).toHaveLength(registry.length);
    expect(discover).toHaveBeenCalledTimes(registry.length);
    expect(diagnostics.some((value) => value.finalOutcome === "UNSUPPORTED")).toBe(false);
    expect(diagnostics.some((value) => value.finalOutcome === "CONFIGURATION_ERROR")).toBe(false);
  });

  it("terminates a non-resolving platform invocation and continues the bounded worker pool", async () => {
    const original = process.env.PLATFORM_ITEM_TIMEOUT_MS;
    process.env.PLATFORM_ITEM_TIMEOUT_MS = "1000";
    try {
      const diagnostics: Array<{ platform: string; finalOutcome?: string }> = [];
      const timeoutPlatform = registryModule.JOB_PLATFORM_REGISTRY[0]?.name;
      const discover = jest.fn(async (platform: string) => {
        if (platform === timeoutPlatform) return await new Promise<never>(() => undefined);
        return [];
      });
      const source = new CatalogAwarePlatformSearchJobSource(discover, (value) => {
        diagnostics.push({ platform: value.platform, finalOutcome: value.finalOutcome });
      });

      await expect(source.fetchJobs()).resolves.toEqual([]);

      const registry = registryModule.JOB_PLATFORM_REGISTRY;
      expect(discover).toHaveBeenCalledTimes(registry.length);
      expect(diagnostics).toHaveLength(registry.length);
      expect(diagnostics.some((value) => value.finalOutcome === "TIMEOUT")).toBe(true);
    } finally {
      if (original === undefined) delete process.env.PLATFORM_ITEM_TIMEOUT_MS;
      else process.env.PLATFORM_ITEM_TIMEOUT_MS = original;
    }
  });
});
