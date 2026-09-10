import { PlatformSearchJobSource } from "./PlatformSearchJobSource";
import { JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";

describe("PlatformSearchJobSource", () => {
  it("processes the complete registry while keeping active platform concurrency at four", async () => {
    expect(JOB_PLATFORM_REGISTRY.length).toBeGreaterThanOrEqual(200);

    let active = 0;
    let peak = 0;
    const processed: string[] = [];
    const discovery = jest.fn(async (platformName: string) => {
      active += 1;
      peak = Math.max(peak, active);
      processed.push(platformName);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return [];
    });

    const jobs = await new PlatformSearchJobSource(discovery).fetchJobs();

    expect(jobs).toEqual([]);
    expect(discovery).toHaveBeenCalledTimes(JOB_PLATFORM_REGISTRY.length);
    expect(processed).toHaveLength(JOB_PLATFORM_REGISTRY.length);
    expect(new Set(processed).size).toBe(new Set(JOB_PLATFORM_REGISTRY.map((platform) => platform.name)).size);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it("stops before issuing platform work when the source signal is already aborted", async () => {
    const discovery = jest.fn(async () => []);
    const controller = new AbortController();
    controller.abort();

    await expect(new PlatformSearchJobSource(discovery).fetchJobs(controller.signal)).resolves.toEqual([]);
    expect(discovery).not.toHaveBeenCalled();
  });
});
