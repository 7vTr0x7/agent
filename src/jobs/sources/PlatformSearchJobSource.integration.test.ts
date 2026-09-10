import { discoverPlatform } from "./PlatformSearchJobSource";
import { PlaywrightJobPageRenderer } from "./RenderedJobPageRenderer";

describe("PlatformSearchJobSource integration pipeline", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const searchPage = "[React Developer](https://jobs.example.com/opening/123)";
  const staticJobPage = `<script type="application/ld+json">{"@type":"JobPosting","title":"React Developer","description":"Build React and TypeScript applications for the product team.","hiringOrganization":{"@type":"Organization","name":"Acme Corp","sameAs":"https://acme.example.com"},"jobLocation":{"address":{"addressLocality":"Bengaluru","addressCountry":"India"}}}</script>`;

  function mockFetch(jobPage: string): void {
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("r.jina.ai/https://www.google.com") || url.includes("r.jina.ai/https://www.bing.com") || url.includes("r.jina.ai/https://html.duckduckgo.com")) {
        return new Response(searchPage, { status: 200, headers: { "content-type": "text/plain" } });
      }
      if (url === "https://jobs.example.com/opening/123") {
        return new Response(jobPage, { status: 200, headers: { "content-type": "text/html" } });
      }
      return new Response("not found", { status: 404 });
    });
  }

  it("flows from search result URL to static job-page parsing", async () => {
    mockFetch(staticJobPage);
    const diagnostics: Array<Record<string, unknown>> = [];

    const jobs = await discoverPlatform("LinkedIn Jobs", undefined, (value) => diagnostics.push(value as unknown as Record<string, unknown>));

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe("React Developer");
    expect(jobs[0]?.companyName).toBe("Acme Corp");
    expect(diagnostics.at(-1)?.searchReturnedUrls).toBeGreaterThan(0);
    expect(diagnostics.at(-1)?.uniqueUrls).toBe(1);
    expect(diagnostics.at(-1)?.staticJobsParsed).toBe(1);
    expect(diagnostics.at(-1)?.renderAttempts).toBe(0);
  });

  it("falls back to Playwright only after static parsing returns zero jobs", async () => {
    const staticHtml = "<html><head><title>React Developer</title></head><body>React Developer</body></html>";
    mockFetch(staticHtml);
    const renderSpy = jest.spyOn(PlaywrightJobPageRenderer.prototype, "render").mockResolvedValue({
      result: { html: staticJobPage, detailUrls: [] },
      diagnostics: { outcome: "render_success", detailUrls: 0, visibleJobs: 1, finalUrl: "https://jobs.example.com/opening/123" }
    });
    const diagnostics: Array<Record<string, unknown>> = [];

    const jobs = await discoverPlatform("LinkedIn Jobs", undefined, (value) => diagnostics.push(value as unknown as Record<string, unknown>));

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.companyName).toBe("Acme Corp");
    expect(diagnostics.at(-1)?.staticJobsParsed).toBe(0);
    expect(diagnostics.at(-1)?.renderAttempts).toBe(1);
    expect(diagnostics.at(-1)?.renderJobsParsed).toBe(1);
  });
});
