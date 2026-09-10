import { discoverPlatform } from "./PlatformSearchJobSource";
import { PlaywrightJobPageRenderer } from "./RenderedJobPageRenderer";

describe("PlatformSearchJobSource rendered detail links", () => {
  afterEach(() => jest.restoreAllMocks());

  it("processes every legitimate detail URL discovered on a rendered collection page", async () => {
    const detailUrls = [
      "https://jobs.example.com/job/1",
      "https://jobs.example.com/job/2",
      "https://jobs.example.com/job/3"
    ];
    const searchUrl = "https://jobs.example.com/search/react";
    const jobPage = (id: string): string => `<script type="application/ld+json">${JSON.stringify({
      "@type": "JobPosting",
      title: `React Developer ${id}`,
      description: `Build React applications for Company ${id} with TypeScript and modern frontend tooling.`,
      hiringOrganization: { "@type": "Organization", name: `Company ${id}` },
      url: `https://jobs.example.com/job/${id}`
    })}</script>`;

    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("r.jina.ai/")) return new Response(`[React](${searchUrl})`, { status: 200 });
      if (url === searchUrl) return new Response("<html><body>dynamic listing</body></html>", { status: 200 });
      const detail = detailUrls.find((candidate) => candidate === url);
      if (detail) return new Response(jobPage(detail.split("/").pop() ?? "unknown"), { status: 200 });
      return new Response("not found", { status: 404 });
    });

    jest.spyOn(PlaywrightJobPageRenderer.prototype, "render").mockResolvedValue({
      result: { html: "<html><body>rendered collection</body></html>", detailUrls },
      diagnostics: { outcome: "render_success", detailUrls: detailUrls.length, visibleJobs: 0, finalUrl: searchUrl }
    });

    const jobs = await discoverPlatform("LinkedIn Jobs");

    expect(jobs).toHaveLength(3);
    expect(new Set(jobs.map((job) => job.url))).toEqual(new Set(detailUrls));
  });
});
