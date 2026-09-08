import { FreePublicJobFeedBundleSource } from "./FreePublicJobFeedBundleSource";

describe("FreePublicJobFeedBundleSource", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("continues across feed failures and normalizes successful feeds", async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("broken.example")) return new Response("nope", { status: 503 });
      return new Response(`<?xml version="1.0"?><rss><channel><item><guid>${url}</guid><title>Frontend Engineer</title><link>${url}/job/1</link><description>Build React and TypeScript applications.</description><dc:creator>Example Co</dc:creator><pubDate>Wed, 09 Sep 2026 08:00:00 GMT</pubDate></item></channel></rss>`, { status: 200, headers: { "content-type": "application/rss+xml" } });
    }) as typeof fetch;

    const source = new FreePublicJobFeedBundleSource([
      { id: "working:ok", url: "https://ok.example/jobs", defaultCompanyName: "Example" },
      { id: "working:broken", url: "https://broken.example/jobs", defaultCompanyName: "Broken" }
    ]);

    const jobs = await source.fetchJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe("Frontend Engineer");
    expect(jobs[0]?.companyName).toBe("Example Co");
  });
});
