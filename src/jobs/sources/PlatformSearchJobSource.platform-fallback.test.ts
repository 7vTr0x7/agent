import { discoverPlatform } from "./PlatformSearchJobSource";
import { getPlatformSearchUrls } from "./PlatformSearchProfiles";
import { extractSearchResultUrls } from "./SearchResultUrlExtractor";

const cases = [
  { platform: "Cutshort", jobUrl: "https://cutshort.io/job/React-Developer-Bengaluru-Bangalore-Test-Co-abc123" },
  { platform: "Hirist", jobUrl: "https://www.hirist.tech/j/reactjs-developer-test-1660001" },
  { platform: "Foundit", jobUrl: "https://www.foundit.in/job/react-developer-test-company-12345678" }
] as const;

const jobPosting = (url: string, company: string): string =>
  `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "React Developer",
    description: `Build React applications for ${company} with TypeScript and modern frontend tooling.`,
    hiringOrganization: { "@type": "Organization", name: company },
    jobLocation: { address: { addressLocality: "Bengaluru", addressCountry: "India" } },
    url
  })}</script>`;

describe("platform-specific first-party search fallbacks", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(cases)("$platform produces valid job URLs from its first-party search page", async ({ platform, jobUrl }) => {
    const searchUrls = getPlatformSearchUrls(platform);
    expect(searchUrls).toHaveLength(4);

    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("r.jina.ai/")) return new Response("no useful search destinations", { status: 200 });
      if (searchUrls.includes(url)) {
        return new Response(`<html><body><a href="${jobUrl}">React Developer</a><a href="https://www.google.com/search?q=react">Search</a></body></html>`, { status: 200 });
      }
      if (url === jobUrl) return new Response(jobPosting(jobUrl, `${platform} Company`), { status: 200 });
      return new Response("not found", { status: 404 });
    });

    const diagnostics: Array<Record<string, unknown>> = [];
    const jobs = await discoverPlatform(platform, undefined, (value) => diagnostics.push(value as unknown as Record<string, unknown>));

    expect(fetchSpy).toHaveBeenCalled();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.url).toBe(jobUrl);
    expect(jobs[0]?.companyName).toBe(`${platform} Company`);
    expect(diagnostics.at(-1)?.uniqueUrls).toBe(1);
    expect(diagnostics.at(-1)?.staticJobsParsed).toBe(1);
  });

  it.each(cases)("$platform search URLs survive normalization while unsafe/non-job URLs are rejected", ({ jobUrl }) => {
    const page = [
      `[valid](${jobUrl})`,
      "https://www.google.com/search?q=react",
      "https://example.com/login",
      "javascript:alert(1)"
    ].join(" ");
    const result = extractSearchResultUrls(page);
    expect(result.urls).toContain(jobUrl);
    expect(result.urls).not.toContain("https://www.google.com/search?q=react");
    expect(result.urls).not.toContain("https://example.com/login");
    expect(result.urls).not.toContain("javascript:alert(1)");
  });
});
