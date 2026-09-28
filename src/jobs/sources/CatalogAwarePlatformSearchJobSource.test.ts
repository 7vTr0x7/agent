import { CatalogAwarePlatformSearchJobSource } from "./CatalogAwarePlatformSearchJobSource";

const registryModule = jest.requireActual("./JobPlatformRegistry") as typeof import("./JobPlatformRegistry");

describe("CatalogAwarePlatformSearchJobSource", () => {
  it("attempts every registered platform through the public-web acquisition path", async () => {
    const diagnostics: Array<{ platform: string; finalOutcome?: string }> = [];
    const discover = jest.fn(async () => []);
    const source = new CatalogAwarePlatformSearchJobSource(discover, (value) => {
      diagnostics.push({ platform: value.platform, finalOutcome: value.finalOutcome });
    });

    await source.fetchJobs();

    const registry = registryModule.JOB_PLATFORM_REGISTRY;

    expect(diagnostics).toHaveLength(registry.length);
    expect(discover).toHaveBeenCalledTimes(registry.length);
    expect(diagnostics.every((value) => value.finalOutcome === "SUCCESS_ZERO_JOBS")).toBe(true);
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
      expect(discover).toHaveBeenCalledTimes(registry.length);
      expect(diagnostics).toHaveLength(registry.length);
      expect(diagnostics.some((value) => value.finalOutcome === "TIMEOUT")).toBe(true);
      expect(diagnostics.filter((value) => value.finalOutcome === "SUCCESS_ZERO_JOBS")).toHaveLength(registry.length - 1);
    } finally {
      if (original === undefined) delete process.env.PLATFORM_ITEM_TIMEOUT_MS;
      else process.env.PLATFORM_ITEM_TIMEOUT_MS = original;
    }
  });
});
