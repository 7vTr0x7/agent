import { discoverPlatform } from "./PlatformSearchJobSource";

describe("search-engine fallback", () => {
  afterEach(() => jest.restoreAllMocks());

  it("tries another search engine when the first successful response has no usable destinations", async () => {
    const jobUrl = "https://example.com/job/react-developer-1";
    const jobPage = `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: "React Developer",
      description: "Build React applications with TypeScript and modern frontend tooling for the team.",
      hiringOrganization: { "@type": "Organization", name: "Example Corp" },
      jobLocation: { address: { addressLocality: "Bengaluru", addressCountry: "India" } },
      url: jobUrl
    })}</script>`;

    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("r.jina.ai/https://www.google.com")) return new Response("Google challenge without destinations", { status: 200 });
      if (url.includes("r.jina.ai/https://www.bing.com")) return new Response(`[React Developer](${jobUrl})`, { status: 200 });
      if (url.includes("r.jina.ai/https://html.duckduckgo.com")) return new Response("unused", { status: 200 });
      if (url === jobUrl) return new Response(jobPage, { status: 200 });
      return new Response("not found", { status: 404 });
    });

    const diagnostics: Array<Record<string, unknown>> = [];
    const jobs = await discoverPlatform("LinkedIn Jobs", undefined, (value) => diagnostics.push(value as unknown as Record<string, unknown>));

    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("r.jina.ai/https://www.google.com"), expect.anything());
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("r.jina.ai/https://www.bing.com"), expect.anything());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.url).toBe(jobUrl);
    expect(diagnostics.at(-1)?.searchReturnedUrls).toBe(1);
  });
});
