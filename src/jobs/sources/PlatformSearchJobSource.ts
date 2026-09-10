import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";
import { JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";
import { JobPageDiagnostics, parsePlatformJobPage } from "./PlatformJobPageParser";
import { PlaywrightJobPageRenderer } from "./RenderedJobPageRenderer";
import { extractSearchResultUrls, SearchResultExtractionDiagnostics } from "./SearchResultUrlExtractor";

const PLATFORM_CONCURRENCY = 4;
const SEARCH_CONCURRENCY = 2;
const PAGE_CONCURRENCY = 4;
const DETAIL_CONCURRENCY = 4;
const SEARCH_TIMEOUT_MS = 8000;
const PAGE_TIMEOUT_MS = 8000;
const FETCH_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 250;

const TARGET_TERMS = ["React", "Next.js", "Frontend", "Frontend Developer", "React Developer", "React.js", "Next.js Developer", "Full Stack Developer", "Full Stack React", "MERN"] as const;
const LOCATION_TERMS = ["Bengaluru", "Bangalore", "India", "Remote"] as const;

export type PlatformDiscoveryOutcome = "SUCCESS_WITH_JOBS" | "SUCCESS_ZERO_JOBS" | "TIMEOUT" | "RATE_LIMITED" | "NETWORK_ERROR" | "HTTP_ERROR" | "PARSER_ERROR" | "UNSUPPORTED" | "CONFIGURATION_ERROR" | "BLOCKED_OR_RESTRICTED";
export type PlatformExtractionMode = "STATIC_ONLY_SUCCESS" | "RENDERED_SUCCESS" | "STATIC_ZERO_RENDER_ZERO" | "STATIC_ZERO_RENDER_SUCCESS";

export interface PlatformDiscoveryDiagnostics {
  readonly platform: string;
  readonly searchPages: number;
  readonly searchUrlsGenerated?: number;
  readonly searchReturnedUrls: number;
  readonly uniqueUrls: number;
  readonly pageSuccesses: number;
  readonly pageFailures: number;
  readonly parseSuccesses: number;
  readonly parseFailures: number;
  readonly parseFailureReasons: Record<string, number>;
  readonly jobs: number;
  readonly staticJobsParsed?: number;
  readonly renderAttempts?: number;
  readonly renderSuccesses?: number;
  readonly renderJobsParsed?: number;
  readonly detailUrlsDiscovered?: number;
  readonly detailPagesFetched?: number;
  readonly validJobs?: number;
  readonly invalidJobs?: number;
  readonly duplicates?: number;
  readonly timeouts?: number;
  readonly errors?: number;
  readonly finalOutcome?: PlatformDiscoveryOutcome;
  readonly extractionMode?: PlatformExtractionMode;
  readonly searchExtraction?: SearchResultExtractionDiagnostics;
}

export type PlatformDiscovery = (platformName: string, signal?: AbortSignal, onDiagnostic?: (diagnostics: PlatformDiscoveryDiagnostics) => void) => Promise<Job[]>;

/** All registry platforms are traversed; concurrency bounds active work, not coverage. */
export class PlatformSearchJobSource implements JobSource {
  readonly name = "platform-search-federation";

  constructor(
    private readonly platformDiscovery: PlatformDiscovery = discoverPlatform,
    private readonly onDiagnostic: (diagnostics: PlatformDiscoveryDiagnostics) => void = logDiagnostics
  ) {}

  async fetchJobs(signal?: AbortSignal): Promise<Job[]> {
    const platforms = JOB_PLATFORM_REGISTRY;
    if (!platforms.length) return [];
    const results = await mapWithConcurrency(platforms, PLATFORM_CONCURRENCY, async (platform) => {
      if (signal?.aborted) return [];
      try {
        return await this.platformDiscovery(platform.name, signal, this.onDiagnostic);
      } catch {
        this.onDiagnostic({ platform: platform.name, searchPages: 0, searchUrlsGenerated: 0, searchReturnedUrls: 0, uniqueUrls: 0, pageSuccesses: 0, pageFailures: 0, parseSuccesses: 0, parseFailures: 0, parseFailureReasons: { exception: 1 }, jobs: 0, errors: 1, finalOutcome: "PARSER_ERROR" });
        return [];
      }
    });
    return results.flat();
  }
}

const sharedRenderer = new PlaywrightJobPageRenderer();

export async function discoverPlatform(platformName: string, signal?: AbortSignal, onDiagnostic: (diagnostics: PlatformDiscoveryDiagnostics) => void = logDiagnostics): Promise<Job[]> {
  const domain = platformSearchDomain(platformName);
  const queries = buildSearchQueries(platformName, domain);
  const pages = await mapWithConcurrency(queries, SEARCH_CONCURRENCY, async (query) => signal?.aborted ? [] : fetchSearchPages(query, signal));
  const searchPages = pages.flat();
  const extractionTotals = createSearchExtractionTotals();
  const rawUrls = searchPages.flatMap((searchPage) => {
    const extraction = extractSearchResultUrls(searchPage.content, searchPage.baseUrl);
    addSearchExtractionTotals(extractionTotals, extraction.diagnostics);
    return extraction.urls;
  });
  const links = [...new Set(rawUrls.map((url) => url.trim()).filter(Boolean))];
  const diagnosticsBase = { platform: platformName, searchPages: searchPages.length, searchUrlsGenerated: queries.length, searchReturnedUrls: rawUrls.length, uniqueUrls: links.length, searchExtraction: extractionTotals };

  if (signal?.aborted) {
    onDiagnostic({ ...diagnosticsBase, pageSuccesses: 0, pageFailures: 0, parseSuccesses: 0, parseFailures: 0, parseFailureReasons: { aborted: 1 }, jobs: 0, errors: 1, finalOutcome: "TIMEOUT" });
    return [];
  }
  if (!links.length) {
    onDiagnostic({ ...diagnosticsBase, pageSuccesses: 0, pageFailures: 0, parseSuccesses: 0, parseFailures: 0, parseFailureReasons: { no_search_urls: 1 }, jobs: 0, finalOutcome: "SUCCESS_ZERO_JOBS", extractionMode: "STATIC_ZERO_RENDER_ZERO" });
    return [];
  }

  let pageSuccesses = 0, pageFailures = 0, parseSuccesses = 0, parseFailures = 0;
  let staticJobsParsed = 0, renderAttempts = 0, renderSuccesses = 0, renderJobsParsed = 0;
  let detailUrlsDiscovered = 0, detailPagesFetched = 0, invalidJobs = 0, duplicates = 0, timeouts = 0, errors = 0, blocked = 0;
  const parseFailureReasons: Record<string, number> = {};
  const unique = new Map<string, Job>();
  const attemptedRenderUrls = new Set<string>();
  const detailUrls = new Set<string>();

  const collectJob = (job: Job | null): void => {
    if (!job) { invalidJobs += 1; return; }
    const key = job.url.trim().toLowerCase();
    if (unique.has(key)) { duplicates += 1; return; }
    unique.set(key, job);
  };

  await mapWithConcurrency(links, PAGE_CONCURRENCY, async (url) => {
    if (signal?.aborted) return;
    const html = await fetchText(url, PAGE_TIMEOUT_MS, signal);
    if (!html) { pageFailures += 1; errors += 1; return; }
    pageSuccesses += 1;
    const parsed = parsePlatformJobPage(html, url, platformName);
    recordParseDiagnostic(parsed.diagnostics, parseFailureReasons);
    if (parsed.job) { parseSuccesses += 1; staticJobsParsed += 1; collectJob(parsed.job); return; }
    parseFailures += 1;
    if (isRestrictedOrChallengePage(html)) { blocked += 1; return; }

    renderAttempts += 1;
    attemptedRenderUrls.add(url);
    const rendered = await sharedRenderer.render(url, signal);
    if (rendered.diagnostics.outcome === "render_timeout") timeouts += 1;
    if (rendered.diagnostics.outcome === "render_error") errors += 1;
    if (!rendered.result) return;
    renderSuccesses += 1;
    detailUrlsDiscovered += rendered.result.detailUrls.length;
    for (const detailUrl of rendered.result.detailUrls) detailUrls.add(detailUrl);

    const renderedParsed = parsePlatformJobPage(rendered.result.html, url, platformName);
    recordParseDiagnostic(renderedParsed.diagnostics, parseFailureReasons);
    if (renderedParsed.job) { renderJobsParsed += 1; collectJob(renderedParsed.job); }
    else if (isRestrictedOrChallengePage(rendered.result.html)) blocked += 1;
  });

  const canonicalDetailUrls = [...detailUrls].filter((url) => !attemptedRenderUrls.has(url));
  await mapWithConcurrency(canonicalDetailUrls, DETAIL_CONCURRENCY, async (url) => {
    if (signal?.aborted) return;
    const html = await fetchText(url, PAGE_TIMEOUT_MS, signal);
    if (!html) { errors += 1; return; }
    detailPagesFetched += 1;
    const parsed = parsePlatformJobPage(html, url, platformName);
    recordParseDiagnostic(parsed.diagnostics, parseFailureReasons);
    if (parsed.job) { parseSuccesses += 1; collectJob(parsed.job); return; }
    renderAttempts += 1;
    attemptedRenderUrls.add(url);
    const rendered = await sharedRenderer.render(url, signal);
    if (rendered.diagnostics.outcome === "render_timeout") timeouts += 1;
    if (rendered.diagnostics.outcome === "render_error") errors += 1;
    if (!rendered.result) return;
    renderSuccesses += 1;
    const renderedParsed = parsePlatformJobPage(rendered.result.html, url, platformName);
    recordParseDiagnostic(renderedParsed.diagnostics, parseFailureReasons);
    if (renderedParsed.job) { renderJobsParsed += 1; collectJob(renderedParsed.job); }
  });

  const finalJobs = [...unique.values()];
  const finalOutcome: PlatformDiscoveryOutcome = blocked === links.length && finalJobs.length === 0 ? "BLOCKED_OR_RESTRICTED" : finalJobs.length > 0 ? "SUCCESS_WITH_JOBS" : timeouts > 0 && pageSuccesses === 0 ? "TIMEOUT" : errors > 0 && pageSuccesses === 0 ? "NETWORK_ERROR" : "SUCCESS_ZERO_JOBS";
  const extractionMode: PlatformExtractionMode = staticJobsParsed > 0 ? "STATIC_ONLY_SUCCESS" : renderJobsParsed > 0 ? "STATIC_ZERO_RENDER_SUCCESS" : "STATIC_ZERO_RENDER_ZERO";

  onDiagnostic({ ...diagnosticsBase, pageSuccesses, pageFailures, parseSuccesses, parseFailures, parseFailureReasons, jobs: finalJobs.length, staticJobsParsed, renderAttempts, renderSuccesses, renderJobsParsed, detailUrlsDiscovered, detailPagesFetched, validJobs: finalJobs.length, invalidJobs, duplicates, timeouts, errors, finalOutcome, extractionMode });
  return finalJobs;
}

function buildSearchQueries(platformName: string, domain: string | null): string[] {
  const target = `(${TARGET_TERMS.map(quoteSearchTerm).join(" OR ")})`;
  const locations = `(${LOCATION_TERMS.join(" OR ")})`;
  const queries = [
    `"${platformName}" ${target} ${locations}`,
    domain ? `site:${domain} ${target} ${locations}` : `"${platformName}" jobs ${target} ${locations}`,
    domain ? `site:${domain} "React Developer" "Bangalore"` : `"${platformName}" "React Developer" "Bangalore"`,
    domain ? `site:${domain} "Frontend Developer" "India"` : `"${platformName}" "Frontend Developer" "India"`
  ];
  return [...new Set(queries.map((query) => query.trim()).filter(Boolean))];
}

function quoteSearchTerm(value: string): string { return value.includes(" ") || /[.]/.test(value) ? `"${value}"` : value; }
function recordParseDiagnostic(diagnostic: JobPageDiagnostics, reasons: Record<string, number>): void { if (!diagnostic.parsed) { const reason = diagnostic.failure ?? "unknown"; reasons[reason] = (reasons[reason] ?? 0) + 1; } }
function logDiagnostics(diagnostics: PlatformDiscoveryDiagnostics): void { console.info(JSON.stringify({ event: "platform_discovery_diagnostic", ...diagnostics })); }

type SearchPage = { content: string; baseUrl: string };
type SearchExtractionTotals = { -readonly [K in keyof SearchResultExtractionDiagnostics]: SearchResultExtractionDiagnostics[K] };

async function fetchSearchPages(query: string, signal?: AbortSignal): Promise<SearchPage[]> {
  const encoded = encodeURIComponent(query);
  const endpoints: Array<{ url: string; baseUrl: string }> = [
    { url: `https://r.jina.ai/https://www.google.com/search?q=${encoded}&gbv=1`, baseUrl: `https://www.google.com/search?q=${encoded}&gbv=1` },
    { url: `https://r.jina.ai/https://www.bing.com/search?q=${encoded}`, baseUrl: `https://www.bing.com/search?q=${encoded}` },
    { url: `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encoded}`, baseUrl: `https://html.duckduckgo.com/html/?q=${encoded}` }
  ];
  const pages: SearchPage[] = [];
  for (const endpoint of endpoints) {
    if (signal?.aborted) return pages;
    const page = await fetchText(endpoint.url, SEARCH_TIMEOUT_MS, signal);
    if (page) pages.push({ content: page, baseUrl: endpoint.baseUrl });
    if (pages.length >= 1) break;
  }
  if (pages.length || signal?.aborted) return pages;
  const bingRssUrl = `https://www.bing.com/search?format=rss&q=${encoded}`;
  const bingRss = await fetchText(bingRssUrl, SEARCH_TIMEOUT_MS, signal);
  return bingRss ? [{ content: bingRss, baseUrl: bingRssUrl }] : [];
}

function createSearchExtractionTotals(): SearchExtractionTotals {
  return { markdownCandidates: 0, hrefCandidates: 0, rssCandidates: 0, bareUrlCandidates: 0, redirectCandidates: 0, validCandidates: 0, normalizedUrls: 0, duplicates: 0, rejectedCandidates: 0, rejectionReasons: {} };
}
function addSearchExtractionTotals(total: SearchExtractionTotals, current: SearchResultExtractionDiagnostics): void {
  total.markdownCandidates += current.markdownCandidates;
  total.hrefCandidates += current.hrefCandidates;
  total.rssCandidates += current.rssCandidates;
  total.bareUrlCandidates += current.bareUrlCandidates;
  total.redirectCandidates += current.redirectCandidates;
  total.validCandidates += current.validCandidates;
  total.normalizedUrls += current.normalizedUrls;
  total.duplicates += current.duplicates;
  total.rejectedCandidates += current.rejectedCandidates;
  for (const [reason, count] of Object.entries(current.rejectionReasons)) total.rejectionReasons[reason] = (total.rejectionReasons[reason] ?? 0) + count;
}

function platformSearchDomain(platformName: string): string | null {
  const knownDomains: Record<string, string> = {
    Naukri: "naukri.com", "LinkedIn Jobs": "linkedin.com", "Indeed India": "in.indeed.com", Instahyre: "instahyre.com", Cutshort: "cutshort.io", Hirist: "hirist.tech", Foundit: "foundit.in", TimesJobs: "timesjobs.com", Shine: "shine.com", Wellfound: "wellfound.com", "Glassdoor India": "glassdoor.co.in", Internshala: "internshala.com", Unstop: "unstop.com", "Remote OK": "remoteok.com", "We Work Remotely": "weworkremotely.com", Himalayas: "himalayas.app", Jobicy: "jobicy.com", Remotive: "remotive.com", "Remote.co": "remote.co", "Working Nomads": "workingnomads.com", Jobspresso: "jobspresso.co", "Landing.jobs": "landing.jobs", "No Fluff Jobs": "nofluffjobs.com", "Y Combinator Jobs": "ycombinator.com", Greenhouse: "greenhouse.io", Lever: "lever.co", Ashby: "ashbyhq.com", Adzuna: "adzuna.com", Jooble: "jooble.org", JobStreet: "jobstreet.com", SEEK: "seek.com.au", MyCareersFuture: "mycareersfuture.gov.sg"
  };
  return knownDomains[platformName] ?? null;
}
function isRestrictedOrChallengePage(html: string): boolean { const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase(); return ["captcha", "verify you are human", "unusual traffic", "access denied", "robot check", "security check", "challenge-platform", "enable javascript and cookies"].some((signal) => text.includes(signal)); }
function decodeXml(value: string): string { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'"); }

async function fetchText(url: string, timeoutMs: number, parentSignal?: AbortSignal): Promise<string | null> {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    if (parentSignal?.aborted) return null;
    const controller = new AbortController();
    const onParentAbort = (): void => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept: "text/plain,text/html,application/xhtml+xml,application/rss+xml,application/ld+json,*/*;q=0.5", "user-agent": "job-agent-public-platform-discovery/4.0" } });
      if (response.ok) return await response.text();
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) return null;
    } catch { if (parentSignal?.aborted) return null; }
    finally { clearTimeout(timer); parentSignal?.removeEventListener("abort", onParentAbort); }
    if (attempt < FETCH_RETRIES) await delayWithSignal(RETRY_BASE_DELAY_MS * 2 ** attempt, parentSignal);
  }
  return null;
}
async function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> { if (signal?.aborted) return; await new Promise<void>((resolve) => { const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms); const onAbort = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(); }; signal?.addEventListener("abort", onAbort, { once: true }); }); }
async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> { if (!items.length) return []; const output: R[] = new Array(items.length); let index = 0; async function worker(): Promise<void> { while (true) { const current = index++; if (current >= items.length) return; output[current] = await mapper(items[current] as T); } } await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker())); return output; }
