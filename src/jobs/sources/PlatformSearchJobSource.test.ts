import { PlatformSearchJobSource } from "./PlatformSearchJobSource";
import { JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";

describe("PlatformSearchJobSource", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("processes the complete registry with concurrency as a resource limit, not a coverage limit", async () => {
    expect(JOB_PLATFORM_REGISTRY.length).toBeGreaterThanOrEqual(200);

    const calls: string[] = [];
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response("", { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof global.fetch;

    const jobs = await new PlatformSearchJobSource().fetchJobs();

    expect(jobs).toEqual([]);
    // Two independent public-search queries are attempted for every registry
    // entry. With empty responses, each query tries the three search front-ends
    // and then the direct Bing RSS fallback.
    expect(calls).toHaveLength(JOB_PLATFORM_REGISTRY.length * 2 * 4);
  });

  it("stops before issuing network work when the source signal is already aborted", async () => {
    const fetchMock = jest.fn(async () => new Response("", { status: 200 }));
    global.fetch = fetchMock as typeof global.fetch;
    const controller = new AbortController();
    controller.abort();

    await expect(new PlatformSearchJobSource().fetchJobs(controller.signal)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
