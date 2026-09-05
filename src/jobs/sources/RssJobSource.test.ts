import { RssJobSource } from "./RssJobSource";

describe("RssJobSource", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("normalizes RSS job entries into the common Job contract", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `<?xml version="1.0"?>
        <rss><channel>
          <item>
            <guid>job-123</guid>
            <title><![CDATA[Frontend Engineer]]></title>
            <link>https://example.com/jobs/123</link>
            <description><![CDATA[<p>React and TypeScript role</p>]]></description>
            <dc:creator>Example Corp</dc:creator>
            <pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate>
          </item>
        </channel></rss>`,
        { status: 200 }
      )
    );

    const source = new RssJobSource({
      name: "test:rss",
      feedUrl: "https://example.com/jobs.rss"
    });

    const jobs = await source.fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      source: "test:rss",
      sourceJobId: "job-123",
      title: "Frontend Engineer",
      companyName: "Example Corp",
      url: "https://example.com/jobs/123",
      workplaceType: "remote"
    });
  });

  it("fails when the feed returns an HTTP error", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 })
    );

    const source = new RssJobSource({
      name: "test:rss",
      feedUrl: "https://example.com/jobs.rss"
    });

    await expect(source.fetchJobs()).rejects.toMatchObject({
      code: "JOB_SOURCE_REQUEST_FAILED",
      statusCode: 429
    });
  });
});
