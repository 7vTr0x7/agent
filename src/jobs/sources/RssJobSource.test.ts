import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { CandidateProfile } from "../../candidates/CandidateProfile";
import { Job } from "../domain/Job";
import { JobOpportunity } from "../domain/JobOpportunity";
import { DeterministicJobMatcher } from "../../matching/DeterministicJobMatcher";
import { RssJobSource } from "./RssJobSource";

jest.mock("node:dns/promises", () => ({ lookup: jest.fn() }));

const mockedLookup = jest.mocked(lookup);
const originalFetch = global.fetch;

const FEED_URL = "https://feeds.example.com/jobs.xml";
const JOB_URL = "https://jobs.example.com/job-1";
const SOURCE = "fixture-vuejobs-rss";
const SOURCE_JOB_ID = JOB_URL;
const POSTED_AT = "Tue, 15 Sep 2026 14:35:06 +0000";
const RSS_DESCRIPTION = "About Ship4wd Ship4wd is a fast-growing logistics tech startup transforming global supply chains through smart, scalable, and AI-powered solutions. We're building a platform that l...";
const FULL_DESCRIPTION_HTML = [
  "<p>Ship4wd is hiring a Full Stack Developer with a frontend focus to build customer-facing products.</p>",
  "<p>You will build React and Next.js interfaces with TypeScript, responsive UI, REST API integrations, and reusable frontend components.</p>",
  "<p>The role works with product and engineering teams on accessible web experiences, testing, debugging, and production improvements.</p>",
  "<p>We are looking for approximately 3 years of experience building modern frontend applications and collaborating across the stack.</p>"
].join(" ");
const FULL_DESCRIPTION = "Ship4wd is hiring a Full Stack Developer with a frontend focus to build customer-facing products. You will build React and Next.js interfaces with TypeScript, responsive UI, REST API integrations, and reusable frontend components. The role works with product and engineering teams on accessible web experiences, testing, debugging, and production improvements. We are looking for approximately 3 years of experience building modern frontend applications and collaborating across the stack.";

const profile: CandidateProfile = {
  id: "candidate-1",
  yearsExperience: 3,
  skills: ["React", "Next.js", "TypeScript", "Redux Toolkit", "Node.js"],
  targetTitles: ["Frontend Engineer", "Frontend Developer", "Full Stack React Developer"]
};

function response(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

function rssXml(description: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Fixture jobs</title>
    <item>
      <title>Full Stack Developer – Frontend Focus</title>
      <guid>${SOURCE_JOB_ID}</guid>
      <link>${JOB_URL}</link>
      <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Ship4wd</dc:creator>
      <location>IL</location>
      <pubDate>${POSTED_AT}</pubDate>
      <description><![CDATA[${description}]]></description>
    </item>
  </channel>
</rss>`;
}

function detailHtml(): string {
  return `<html><head><title>Full Stack Developer – Frontend Focus</title></head><body>
<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    description: FULL_DESCRIPTION_HTML
  })}</script>
</body></html>`;
}

function asOpportunity(job: Job): JobOpportunity {
  const now = new Date("2026-09-15T15:00:00Z");
  return {
    id: job.sourceJobId,
    canonicalId: job.url,
    canonicalUrl: job.url,
    title: job.title,
    companyName: job.companyName,
    location: job.location,
    country: job.country,
    workplaceType: job.workplaceType,
    employmentType: job.employmentType,
    description: job.description,
    postedAt: job.postedAt,
    sourceUpdatedAt: job.updatedAt,
    lastSeenAt: now,
    closedAt: null,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now
  };
}

function expectedContentHash(description: string): string {
  return createHash("sha256")
    .update([SOURCE, SOURCE_JOB_ID, "Full Stack Developer – Frontend Focus", JOB_URL, description].join("|"))
    .digest("hex");
}

beforeEach(() => {
  mockedLookup.mockReset();
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe("RssJobSource", () => {
  it("normalizes RSS job entries into the common Job contract", async () => {
    jest.mocked(global.fetch).mockResolvedValue(
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
    jest.mocked(global.fetch).mockResolvedValue(
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

  it("passes the runner abort signal to the RSS request", async () => {
    const fetchMock = jest.mocked(global.fetch).mockImplementation(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.signal).toBeDefined();
        expect(init?.signal?.aborted).toBe(false);
        return new Response("<?xml version=\"1.0\"?><rss><channel></channel></rss>", { status: 200 });
      }
    );

    const controller = new AbortController();
    await new RssJobSource({ name: "test:rss", feedUrl: "https://example.com/jobs.rss" }).fetchJobs(controller.signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exercises RSS fetch → normalize → JobDetailEnricher → JobPosting JSON-LD → Job[]", async () => {
    jest.mocked(global.fetch)
      .mockResolvedValueOnce(response(rssXml(RSS_DESCRIPTION)))
      .mockResolvedValueOnce(response(detailHtml()));

    const source = new RssJobSource({ name: SOURCE, feedUrl: FEED_URL });
    const jobs = await source.fetchJobs();

    expect(jobs).toHaveLength(1);
    const result = jobs[0];
    expect(result).toBeDefined();
    expect(result?.description).toBe(FULL_DESCRIPTION);
    expect(result?.title).toBe("Full Stack Developer – Frontend Focus");
    expect(result?.url).toBe(JOB_URL);
    expect(result?.companyName).toBe("Ship4wd");
    expect(result?.location).toBe("IL");
    expect(result?.source).toBe(SOURCE);
    expect(result?.sourceJobId).toBe(SOURCE_JOB_ID);
    expect(result?.postedAt).toEqual(new Date(POSTED_AT));
    expect(result?.contentHash).toBe(expectedContentHash(RSS_DESCRIPTION));

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(jest.mocked(global.fetch).mock.calls[0]?.[0]).toBe(FEED_URL);
    expect(jest.mocked(global.fetch).mock.calls[1]?.[0]).toBe(JOB_URL);
    expect(jest.mocked(global.fetch).mock.calls[1]?.[1]?.redirect).toBe("manual");
  });

  it("does not fetch a detail page for a complete RSS description", async () => {
    const completeDescription = "Full Stack Developer with frontend ownership. Build and maintain web applications with a collaborative engineering team.";
    jest.mocked(global.fetch).mockResolvedValueOnce(response(rssXml(completeDescription, "Data Analyst")));

    const jobs = await new RssJobSource({ name: SOURCE, feedUrl: FEED_URL }).fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.description).toBe(completeDescription);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retains the original RSS job when detail enrichment returns HTTP 404", async () => {
    jest.mocked(global.fetch)
      .mockResolvedValueOnce(response(rssXml(RSS_DESCRIPTION)))
      .mockResolvedValueOnce(response("Not found", 404));

    const jobs = await new RssJobSource({ name: SOURCE, feedUrl: FEED_URL }).fetchJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.description).toBe(RSS_DESCRIPTION);
    expect(jobs[0]?.title).toBe("Full Stack Developer – Frontend Focus");
    expect(jobs[0]?.url).toBe(JOB_URL);
    expect(jobs[0]?.companyName).toBe("Ship4wd");
    expect(jobs[0]?.location).toBe("IL");
    expect(jobs[0]?.source).toBe(SOURCE);
    expect(jobs[0]?.sourceJobId).toBe(SOURCE_JOB_ID);
    expect(jobs[0]?.postedAt).toEqual(new Date(POSTED_AT));
    expect(jobs[0]?.contentHash).toBe(expectedContentHash(RSS_DESCRIPTION));
  });

  it("propagates the source AbortSignal to a pending detail request while retaining the RSS job", async () => {
    const controller = new AbortController();
    let detailSignal: AbortSignal | undefined;

    jest.mocked(global.fetch)
      .mockResolvedValueOnce(response(rssXml(RSS_DESCRIPTION)))
      .mockImplementationOnce((_url, init) => {
        detailSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        });
      });

    const pending = new RssJobSource({ name: SOURCE, feedUrl: FEED_URL }).fetchJobs(controller.signal);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();

    const jobs = await pending;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.description).toBe(RSS_DESCRIPTION);
    expect(detailSignal).toBeDefined();
    expect(detailSignal?.aborted).toBe(true);
  });

  it("shows the existing matcher materially richer evidence after source enrichment", async () => {
    jest.mocked(global.fetch)
      .mockResolvedValueOnce(response(rssXml(RSS_DESCRIPTION)))
      .mockResolvedValueOnce(response(detailHtml()));

    const enrichedJobs = await new RssJobSource({ name: SOURCE, feedUrl: FEED_URL }).fetchJobs();
    const enriched = enrichedJobs[0];
    expect(enriched).toBeDefined();

    const matcher = new DeterministicJobMatcher();
    const beforeJob: Job = { ...(enriched as Job), description: RSS_DESCRIPTION };
    const before = matcher.evaluate(asOpportunity(beforeJob), profile);
    const after = matcher.evaluate(asOpportunity(enriched as Job), profile);

    expect(after.matchScore).toBeGreaterThan(before.matchScore);
    expect(after.matchedSkills.length).toBeGreaterThan(before.matchedSkills.length);
    expect(after.matchedSkills).toEqual(expect.arrayContaining(["React", "Next.js", "TypeScript"]));
    expect(before.evidence.some((entry) => entry.type === "SKILL_GAP")).toBe(true);
    expect(after.evidence.some((entry) => entry.type === "SKILL_MATCH" && entry.detail.includes("React"))).toBe(true);
    expect(after.decision).toBe("APPLY");
  });
});
