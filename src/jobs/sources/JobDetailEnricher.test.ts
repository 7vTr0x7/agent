import { lookup } from "node:dns/promises";
import { Job } from "../domain/Job";
import { JobDetailEnricher, shouldEnrich, validatePublicHttpUrl } from "./JobDetailEnricher";

jest.mock("node:dns/promises", () => ({ lookup: jest.fn() }));

const mockedLookup = jest.mocked(lookup);
const originalFetch = global.fetch;

function job(overrides: Partial<Job> = {}): Job {
  return {
    source: "fixture:rss",
    sourceJobId: "job-1",
    url: "https://jobs.example.com/job-1",
    title: "Frontend Engineer",
    companyName: "Acme",
    companyDomain: "acme.com",
    location: "Bengaluru, India",
    country: "India",
    workplaceType: "remote",
    employmentType: null,
    description: "React frontend engineer ...",
    postedAt: new Date("2026-09-15T10:00:00Z"),
    updatedAt: null,
    contentHash: "rss-content-hash",
    ...overrides
  };
}

function response(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
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

test("enriches a VueJobs-style truncated RSS description from JobPosting JSON-LD", async () => {
  const detailDescription = "<p>Full React frontend job description with responsibilities, requirements, collaboration details, benefits, engineering practices, team context, additional role information for the candidate, interview process, and working environment details.</p>";
  jest.mocked(global.fetch).mockResolvedValue(response(`<html><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", description: detailDescription })}</script></html>`));
  const result = await new JobDetailEnricher().enrich(job());
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(result.description).toBe("Full React frontend job description with responsibilities, requirements, collaboration details, benefits, engineering practices, team context, additional role information for the candidate, interview process, and working environment details.");
  expect(result.description.length).toBeGreaterThan(214);
  expect(result.title).toBe("Frontend Engineer");
  expect(result.url).toBe("https://jobs.example.com/job-1");
  expect(result.companyName).toBe("Acme");
  expect(result.location).toBe("Bengaluru, India");
  expect(result.postedAt).toEqual(new Date("2026-09-15T10:00:00Z"));
  expect(result.source).toBe("fixture:rss");
  expect(result.contentHash).toBe("rss-content-hash");
});

test("does not fetch a complete RSS description", async () => {
  const original = job({ description: "A complete job description without an excerpt marker." });
  const result = await new JobDetailEnricher().enrich(original);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(result).toEqual(original);
});

test("fetches an empty description when the canonical URL is valid", async () => {
  jest.mocked(global.fetch).mockResolvedValue(response(`<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", description: "<p>Recovered full description.</p>" })}</script>`));
  const result = await new JobDetailEnricher().enrich(job({ description: "" }));
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(result.description).toBe("Recovered full description.");
});

test.each([404, 403, 429, 500])("keeps the original job on HTTP %i", async (status) => {
  const original = job();
  jest.mocked(global.fetch).mockResolvedValue(response("", status));
  await expect(new JobDetailEnricher().enrich(original)).resolves.toEqual(original);
});

test("prefers canonical main text when JSON-LD is present but omits the numeric experience requirement", async () => {
  jest.mocked(global.fetch).mockResolvedValue(response(`<html><script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", description: "Senior Frontend Engineer building React applications." })}</script><main><h1>Senior Frontend Engineer</h1><p>At least 7 years of professional software engineering experience.</p></main></html>`));
  const result = await new JobDetailEnricher().enrich(job({ description: "React and TypeScript" }));
  expect(result.description).toContain("7 years");
});

test("recovers numeric experience requirements from a canonical HTML main section when JSON-LD is absent", async () => {
  jest.mocked(global.fetch).mockResolvedValue(response("<html><main><h1>Senior Frontend Engineer</h1><p>At least 7 years of professional software engineering experience.</p><p>React and TypeScript.</p></main></html>"));
  const result = await new JobDetailEnricher().enrich(job({ description: "React and TypeScript" }));
  expect(result.description).toContain("seven years");
});

test("keeps the original job when the page has no usable JobPosting description", async () => {
  const original = job();
  jest.mocked(global.fetch).mockResolvedValue(response("<html><main>navigation cookie banner recommendations</main></html>"));
  await expect(new JobDetailEnricher().enrich(original)).resolves.toEqual(original);
});

test("respects AbortSignal and does not replace the RSS job", async () => {
  const original = job();
  const controller = new AbortController();
  jest.mocked(global.fetch).mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }));
  const pending = new JobDetailEnricher({ timeoutMs: 5_000 }).enrich(original, controller.signal);
  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort();
  await expect(pending).resolves.toEqual(original);
  expect(jest.mocked(global.fetch).mock.calls[0]?.[1]?.signal).toBeDefined();
});

test("aborts a detail request when its bounded timeout expires", async () => {
  const original = job();
  let aborted = false;
  jest.mocked(global.fetch).mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Timed out", "AbortError")); }, { once: true });
  }));
  await expect(new JobDetailEnricher({ timeoutMs: 5 }).enrich(original)).resolves.toEqual(original);
  expect(aborted).toBe(true);
});

test("bounds detail requests with a deterministic concurrency limit", async () => {
  let active = 0;
  let peak = 0;
  const resolvers: Array<() => void> = [];
  jest.mocked(global.fetch).mockImplementation(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => resolvers.push(resolve));
    active -= 1;
    return response("<script type=\"application/ld+json\">{\"@type\":\"JobPosting\",\"description\":\"Recovered\"}</script>");
  });
  const pending = new JobDetailEnricher({ concurrency: 2 }).enrichJobs([job({ sourceJobId: "1" }), job({ sourceJobId: "2" }), job({ sourceJobId: "3" }), job({ sourceJobId: "4" })]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(peak).toBe(2);
  resolvers.splice(0).forEach((resolve) => resolve());
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(peak).toBe(2);
  resolvers.splice(0).forEach((resolve) => resolve());
  const results = await pending;
  expect(results).toHaveLength(4);
  expect(results.every((entry) => entry.description === "Recovered")).toBe(true);
});

test("rejects unsupported protocols and private or local destinations before fetch", async () => {
  for (const url of [
    "file:///etc/passwd", "data:text/plain,secret", "javascript:alert(1)", "ftp://example.com/job",
    "http://localhost/job", "http://127.0.0.1/job", "http://10.0.0.1/job", "http://172.16.0.1/job",
    "http://192.168.1.1/job", "http://169.254.169.254/job", "http://[::1]/job", "http://[fc00::1]/job", "http://[fe80::1]/job"
  ]) await expect(validatePublicHttpUrl(url)).rejects.toThrow();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("rejects hostnames that resolve to private addresses", async () => {
  mockedLookup.mockResolvedValue([{ address: "10.0.0.8", family: 4 }] as never);
  await expect(validatePublicHttpUrl("https://jobs.example.com/job")).rejects.toThrow(/non-public/i);
  expect(global.fetch).not.toHaveBeenCalled();
});

test("accepts a public HTTPS hostname after DNS validation", async () => {
  mockedLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
  await expect(validatePublicHttpUrl("https://jobs.example.com/job")).resolves.toBe("https://jobs.example.com/job");
});

test("rejects a public-to-private redirect", async () => {
  mockedLookup
    .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
    .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }] as never);
  jest.mocked(global.fetch).mockResolvedValue(response("", 302, { location: "http://internal.example/job" }));
  const original = job();
  await expect(new JobDetailEnricher().enrich(original)).resolves.toEqual(original);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test("follows and validates a public-to-public redirect", async () => {
  mockedLookup
    .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
    .mockResolvedValueOnce([{ address: "93.184.216.35", family: 4 }] as never);
  jest.mocked(global.fetch)
    .mockResolvedValueOnce(response("", 302, { location: "https://jobs.example.com/job-final" }))
    .mockResolvedValueOnce(response("<script type=\"application/ld+json\">{\"@type\":\"JobPosting\",\"description\":\"Redirected full description\"}</script>"));
  const result = await new JobDetailEnricher().enrich(job());
  expect(result.description).toBe("Redirected full description");
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(jest.mocked(global.fetch).mock.calls[0]?.[1]?.redirect).toBe("manual");
});

test("keeps the same normalized identity when the same RSS job is enriched twice", async () => {
  jest.mocked(global.fetch).mockImplementation(async () => response("<script type=\"application/ld+json\">{\"@type\":\"JobPosting\",\"description\":\"Recovered full description\"}</script>"));
  const enricher = new JobDetailEnricher();
  const first = await enricher.enrich(job());
  const second = await enricher.enrich(job());
  expect(first.source).toBe(second.source);
  expect(first.sourceJobId).toBe(second.sourceJobId);
  expect(first.url).toBe(second.url);
  expect(first.contentHash).toBe(second.contentHash);
  expect(first.description).toBe("Recovered full description");
  expect(second.description).toBe("Recovered full description");
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test("enriches target-like complete summaries when numeric experience is absent", () => {
  expect(shouldEnrich("React frontend engineer with responsibilities and requirements.", "Senior Frontend Engineer")).toBe(true);
  expect(shouldEnrich("React frontend engineer with 3+ years of experience.", "Senior Frontend Engineer")).toBe(false);
  expect(shouldEnrich("General engineering role with no numeric requirement.", "Data Engineer")).toBe(false);
});

test("keeps enrichment source-agnostic and only enriches obvious excerpts", () => {
  expect(shouldEnrich("React frontend engineer ... ")).toBe(true);
  expect(shouldEnrich("React frontend engineer...")).toBe(true);
  expect(shouldEnrich("")).toBe(true);
  expect(shouldEnrich("React frontend engineer with full responsibilities")).toBe(false);
});
