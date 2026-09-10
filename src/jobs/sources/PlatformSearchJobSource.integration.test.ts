import { discoverPlatform } from "./PlatformSearchJobSource";
import { PlaywrightJobPageRenderer } from "./RenderedJobPageRenderer";

describe("PlatformSearchJobSource integration pipeline", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const searchPage = "[React Developer](https://jobs.example.com/opening/123)";

  const jobPosting = (id: number, title: string, company: string): Record<string, unknown> => ({
    "@type": "JobPosting",
    title,
    description: `Build ${title} applications for ${company}.`,
    hiringOrganization: { "@type": "Organization", name: company, sameAs: "https://acme.example.com" },
    jobLocation: { address: { addressLocality: "Bengaluru", addressCountry: "India" } },
    url: `https://jobs.example.com/opening/${id}`
  });

  const collectionPage = (jobs: readonly Record<string, unknown>[]): string =>
    `<script type="application/ld+json">${JSON.stringify(jobs)}</script>`;

  function mockFetch(jobPage: string, extraPages: Record<string, string> = {}): void {
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("r.jina.ai/https://www.google.com") || url.includes("r.jina.ai/https://www.bing.com") || url.includes("r.jina.ai/https://html.duckduckgo.com")) {
        return new Response(searchPage, { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (url in extraPages) return new Response(extraPages[url], { status: 200, headers: { "content-type": "text/html" } });
      if (url === "https://jobs.example.com/opening/123") {
        return new Response(jobPage, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("not found", { status: 404 });
    });
  }

  it("parses all static collection records and does not truncate to one job", async () => {
    mockFetch(collectionPage([
      jobPosting(1, "React Engineer", "Acme One"),
      jobPosting(2, "Frontend Engineer", "Acme Two"),
      jobPosting(3, "Next.js Engineer", "Acme Three")
    ]));
    const diagnostics: Array<Record<string, unknown>> = [];

    const jobs = await discoverPlatform("LinkedIn Jobs", undefined, (value) => diagnostics.push(value as unknown as Record<string, unknown>));

    expect(jobs).toHaveLength(3);
    expect(jobs.map((job) => job.title)).toEqual(["React Engineer", "Frontend Engineer", "Next.js Engineer"]);
    expect(diagnostics.at(-1)?.staticJobsParsed).toBe(3);
    expect(diagnostics.at(-1)?.renderAttempts).toBe(0);
    expect(diagnostics.at(-1)?.jobs).toBe(3);
  });

  it("parses all rendered collection records after static parsing returns zero", async () => {
    const staticHtml = "<html><head><title>React Developer</title></head><body>React Developer</body></html>";
    const renderedHtml = collectionPage([
      jobPosting(11, "React Developer", "Rendered One"),
      jobPosting(12, "Frontend Developer", "Rendered Two"),
      jobPosting(13, "Next.js Developer", "Rendered Three"),
      jobPosting(14, "Full Stack React Developer", "Rendered Four"),
      jobPosting(15, "MERN Developer", "Rendered Five")
    ]);
    mockFetch(staticHtml);
    const renderSpy = jest.spyOn(PlaywrightJobPageRenderer.prototype, "render").mockResolvedValue({
      result: { html: renderedHtml, detailUrls: [] },
      diagnostics: { outcome: "render_success", detailUrls: 0, visibleJobs: 5, finalUrl: "https://jobs.example.com/opening/123" }
    });
    const diagnostics: Array<Record<string, unknown>> = [];

    const jobs = await discoverPlatform("LinkedIn Jobs", undefined, (value) => diagnostics.push(value as unknown as Record<string, unknown>));

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(5);
    expect(jobs.map((job) => job.companyName)).toEqual(["Rendered One", "Rendered Two", "Rendered Three", "Rendered Four", "Rendered Five"]);
    expect(diagnostics.at(-1)?.staticJobsParsed).toBe(0);
    expect(diagnostics.at(-1)?.renderAttempts).toBe(1);
    expect(diagnostics.at(-1)?.renderJobsParsed).toBe(5);
  });

  it("does not render when static collection parsing already produced jobs", async () => {
    mockFetch(collectionPage([jobPosting(21, "React Engineer", "Static One"), jobPosting(22, "Frontend Engineer", "Static Two")]));
    const renderSpy = jest.spyOn(PlaywrightJobPageRenderer.prototype, "render");

    const jobs = await discoverPlatform("LinkedIn Jobs");

    expect(jobs).toHaveLength(2);
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("keeps a single-job detail page working", async () => {
    mockFetch(collectionPage([jobPosting(31, "React Developer", "Acme Corp")]));

    const jobs = await discoverPlatform("LinkedIn Jobs");

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe("React Developer");
    expect(jobs[0]?.companyName).toBe("Acme Corp");
  });

  it("filters invalid mixed collection records while retaining every valid record", async () => {
    mockFetch(collectionPage([
      jobPosting(41, "React Engineer", "Valid One"),
      { "@type": "WebPage", name: "Not a job" },
      { "@type": "JobPosting", title: "Missing employer", description: "Invalid" },
      jobPosting(42, "Frontend Engineer", "Valid Two")
    ]));

    const jobs = await discoverPlatform("LinkedIn Jobs");

    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.companyName)).toEqual(["Valid One", "Valid Two"]);
  });

  it("deduplicates duplicate job representations from the same collection page", async () => {
    mockFetch(collectionPage([
      jobPosting(51, "React Engineer", "Acme"),
      jobPosting(51, "React Engineer", "Acme")
    ]));
    const diagnostics: Array<Record<string, unknown>> = [];

    const jobs = await discoverPlatform("LinkedIn Jobs", undefined, (value) => diagnostics.push(value as unknown as Record<string, unknown>));

    expect(jobs).toHaveLength(1);
    // The existing collection parser owns same-page representation deduplication;
    // the source still applies its normal URL dedupe to records returned by it.
    expect(diagnostics.at(-1)?.jobs).toBe(1);
  });

  it("preserves detail URL discovery and parses discovered detail pages", async () => {
    const staticHtml = "<html><body>dynamic listing</body></html>";
    const renderedHtml = "<html><body>rendered listing</body></html>";
    const detailUrl = "https://jobs.example.com/opening/detail-77";
    mockFetch(staticHtml, {
      [detailUrl]: collectionPage([jobPosting(77, "React Developer", "Detail Company")])
    });
    const renderSpy = jest.spyOn(PlaywrightJobPageRenderer.prototype, "render")
      .mockResolvedValueOnce({
        result: { html: renderedHtml, detailUrls: [detailUrl] },
        diagnostics: { outcome: "render_success", detailUrls: 1, visibleJobs: 0, finalUrl: "https://jobs.example.com/opening/123" }
      });

    const jobs = await discoverPlatform("LinkedIn Jobs");

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.companyName).toBe("Detail Company");
  });

  it("falls back to rendering when collection parsing cannot produce a job", async () => {
    const malformedCollection = "<script type=\"application/ld+json\">not-json</script>";
    mockFetch(malformedCollection);
    const renderSpy = jest.spyOn(PlaywrightJobPageRenderer.prototype, "render").mockResolvedValue({
      result: { html: collectionPage([jobPosting(88, "React Developer", "Recovered Corp")]), detailUrls: [] },
      diagnostics: { outcome: "render_success", detailUrls: 0, visibleJobs: 1, finalUrl: "https://jobs.example.com/opening/123" }
    });

    const jobs = await discoverPlatform("LinkedIn Jobs");

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.companyName).toBe("Recovered Corp");
  });

  it("records rendered job count for every record instead of one per page", async () => {
    mockFetch("<html><body>dynamic</body></html>");
    jest.spyOn(PlaywrightJobPageRenderer.prototype, "render").mockResolvedValue({
      result: { html: collectionPage([jobPosting(91, "React One", "One"), jobPosting(92, "React Two", "Two")]), detailUrls: [] },
      diagnostics: { outcome: "render_success", detailUrls: 0, visibleJobs: 2, finalUrl: "https://jobs.example.com/opening/123" }
    });
    const diagnostics: Array<Record<string, unknown>> = [];

    const jobs = await discoverPlatform("LinkedIn Jobs", undefined, (value) => diagnostics.push(value as unknown as Record<string, unknown>));

    expect(jobs).toHaveLength(2);
    expect(diagnostics.at(-1)?.renderJobsParsed).toBe(2);
  });
});