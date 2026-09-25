import { PlatformSearchJobSource, getPlatformConcurrency } from "./PlatformSearchJobSource";
import { JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";
import type { Job } from "../domain/Job";

describe("PlatformSearchJobSource", () => {
  const job = (id: string): Job => ({ source: "test", sourceJobId: id, url: `https://jobs.example/${id}`, title: "React Developer", companyName: "Example Corp", companyDomain: "example.com", location: "Bengaluru, India", country: "India", workplaceType: "onsite", employmentType: "Full-time", description: "Build React applications.", postedAt: null, updatedAt: null, contentHash: id });
  const executablePlatforms = (): typeof JOB_PLATFORM_REGISTRY[number][] => JOB_PLATFORM_REGISTRY.filter((platform) => platform.capability !== "catalog-only");

  afterEach(() => { delete process.env.PLATFORM_SEARCH_CONCURRENCY; });

  it("processes the complete executable registry without an artificial platform-count cap", async () => {
    expect(JOB_PLATFORM_REGISTRY.length).toBeGreaterThanOrEqual(200);
    const executable = executablePlatforms();
    expect(executable.length).toBeGreaterThan(0);
    expect(executable.length).toBeLessThan(JOB_PLATFORM_REGISTRY.length);
    process.env.PLATFORM_SEARCH_CONCURRENCY = "9";
    expect(getPlatformConcurrency()).toBe(9);
    let active = 0; let peak = 0; const processed: string[] = [];
    const discovery = jest.fn(async (platformName: string) => { active += 1; peak = Math.max(peak, active); processed.push(platformName); await new Promise((resolve) => setTimeout(resolve, 1)); active -= 1; return []; });
    await expect(new PlatformSearchJobSource(discovery).fetchJobs()).resolves.toEqual([]);
    expect(discovery).toHaveBeenCalledTimes(executable.length);
    expect(processed).toHaveLength(executable.length);
    expect(new Set(processed).size).toBe(new Set(executable.map((platform) => platform.name)).size);
    expect(processed).not.toContain(JOB_PLATFORM_REGISTRY.find((platform) => platform.capability === "catalog-only")?.name);
    expect(peak).toBeGreaterThan(4);
    expect(peak).toBeLessThanOrEqual(9);
  });

  it("does not impose a jobs-per-platform cap", async () => {
    const source = new PlatformSearchJobSource(async () => [1, 2, 3, 4, 5, 6, 7].map((id) => job(String(id))));
    const jobs = await source.fetchJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(7);
  });

  it("isolates one failing platform from the remaining executable registry", async () => {
    const executable = executablePlatforms();
    const processed: string[] = [];
    const discovery = jest.fn(async (platformName: string) => { processed.push(platformName); if (platformName === executable[0]?.name) throw new Error("synthetic platform failure"); return []; });
    await expect(new PlatformSearchJobSource(discovery).fetchJobs()).resolves.toEqual([]);
    expect(processed).toHaveLength(executable.length);
  });

  it("stops before issuing platform work when the source signal is already aborted", async () => {
    const discovery = jest.fn(async () => []); const controller = new AbortController(); controller.abort();
    await expect(new PlatformSearchJobSource(discovery).fetchJobs(controller.signal)).resolves.toEqual([]);
    expect(discovery).not.toHaveBeenCalled();
  });
});
