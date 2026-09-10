jest.mock("./PlatformJobPageCollectionParser", () => ({
  parsePlatformJobPageCollection: jest.fn()
}));

import { discoverPlatform } from "./PlatformSearchJobSource";
import { parsePlatformJobPageCollection } from "./PlatformJobPageCollectionParser";
import { PlaywrightJobPageRenderer } from "./RenderedJobPageRenderer";
import type { Job } from "../domain/Job";

const mockedCollectionParser = jest.mocked(parsePlatformJobPageCollection);

describe("PlatformSearchJobSource collection parser wiring", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    mockedCollectionParser.mockReset();
  });

  const job = (id: string): Job => ({
    source: "platform-search:test",
    sourceJobId: `test:${id}`,
    url: `https://jobs.example.com/${id}`,
    title: `React ${id}`,
    companyName: `Company ${id}`,
    companyDomain: "example.com",
    location: "Bengaluru, India",
    country: "India",
    workplaceType: "onsite",
    employmentType: "Full-time",
    description: `Build React applications for ${id}.`,
    postedAt: null,
    updatedAt: null,
    contentHash: id
  });

  function mockNetwork(): void {
    jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("r.jina.ai/")) return new Response("[result](https://jobs.example.com/search)", { status: 200 });
      if (url === "https://jobs.example.com/search") return new Response("listing", { status: 200 });
      return new Response("not found", { status: 404 });
    });
  }

  it("invokes the existing collection parser for static pages and retains every returned job", async () => {
    mockNetwork();
    mockedCollectionParser.mockReturnValue({ jobs: [job("1"), job("2"), job("3")], detailUrls: [] });
    const renderSpy = jest.spyOn(PlaywrightJobPageRenderer.prototype, "render");

    const jobs = await discoverPlatform("LinkedIn Jobs");

    expect(mockedCollectionParser).toHaveBeenCalled();
    expect(jobs).toHaveLength(3);
    expect(renderSpy).not.toHaveBeenCalled();
  });

  it("invokes the existing collection parser for rendered pages after a static zero", async () => {
    mockNetwork();
    mockedCollectionParser
      .mockReturnValueOnce({ jobs: [], detailUrls: [] })
      .mockReturnValueOnce({ jobs: [job("1"), job("2"), job("3"), job("4"), job("5")], detailUrls: [] });
    const renderSpy = jest.spyOn(PlaywrightJobPageRenderer.prototype, "render").mockResolvedValue({
      result: { html: "rendered listing", detailUrls: [] },
      diagnostics: { outcome: "render_success", detailUrls: 0, visibleJobs: 5, finalUrl: "https://jobs.example.com/search" }
    });

    const jobs = await discoverPlatform("LinkedIn Jobs");

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(mockedCollectionParser).toHaveBeenCalledTimes(2);
    expect(jobs).toHaveLength(5);
  });
});
