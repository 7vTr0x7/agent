import { PlatformSearchJobSource, getPlatformConcurrency } from "./PlatformSearchJobSource";
import { JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";
import type { Job } from "../domain/Job";

describe("PlatformSearchJobSource", () => {
  const job = (id: string): Job => ({ source: "test", sourceJobId: id, url: `https://jobs.example/${id}`, title: "React Developer", companyName: "Example Corp", companyDomain: "example.com", location: "Bengaluru, India", country: "India", workplaceType: "onsite", employmentType: "Full-time", description: "Build React applications.", postedAt: null, updatedAt: null, contentHash: id });

  afterEach(() => { delete process.env.PLATFORM_SEARCH_CONCURRENCY; });

  it("processes the complete registry without an artificial platform-count cap", async () => {
    expect(JOB_PLATFORM_REGISTRY.length).toBeGreaterThanOrEqual(200);
    process.env.PLATFORM_SEARCH_CONCURRENCY = "9";
    expect(getPlatformConcurrency()).toBe(9);
    let active = 0; let peak = 0; const processed: string[] = [];
    const discovery = jest.fn(async (platformName: string) => { active += 1; peak = Math.max(peak, active); processed.push(platformName); await new Promise((resolve) => setTimeout(resolve, 1)); active -= 1; return []; });
    await expect(new PlatformSearchJobSource(discovery).fetchJobs()).resolves.toEqual([]);
    expect(discovery).toHaveBeenCalledTimes(JOB_PLATFORM_REGISTRY.length);
    expect(processed).toHaveLength(JOB_PLATFORM_REGISTRY.length);
    expect(new Set(processed).size).toBe(new Set(JOB_PLATFORM_REGISTRY.map((platform) => platform.name)).size);
    expect(peak).toBeGreaterThan(4);
  });

  it("does not impose a jobs-per-platform cap", async () => {
    const source = new PlatformSearchJobSource(async () => [1, 2, 3, 4, 5, 6, 7].map((id) => job(String(id))));
    const jobs = await source.fetchJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(7);
  });

  it("isolates one failing platform from the remaining registry", async () => {
    const processed: string[] = [];
    const discovery = jest.fn(async (platformName: string) => { processed.push(platformName); if (platformName === JOB_PLATFORM_REGISTRY[0]?.name) throw new Error("synthetic platform failure"); return []; });
    await expect(new PlatformSearchJobSource(discovery).fetchJobs()).resolves.toEqual([]);
    expect(processed).toHaveLength(JOB_PLATFORM_REGISTRY.length);
  });

  it("stops before issuing platform work when the source signal is already aborted", async () => {
    const discovery = jest.fn(async () => []); const controller = new AbortController(); controller.abort();
    await expect(new PlatformSearchJobSource(discovery).fetchJobs(controller.signal)).resolves.toEqual([]);
    expect(discovery).not.toHaveBeenCalled();
  });
});
