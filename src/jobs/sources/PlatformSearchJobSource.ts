import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";
import { JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";
import { JobPageDiagnostics, parsePlatformJobPage } from "./PlatformJobPageParser";

const SEARCH_CONCURRENCY = 4;
const SEARCH_TIMEOUT_MS = 8000;
const PAGE_TIMEOUT_MS = 8000;
const FETCH_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 250;

export interface PlatformDiscoveryDiagnostics {
  readonly platform: string;
  readonly searchPages: number;
  readonly searchReturnedUrls: number;
  readonly uniqueUrls: number;
  readonly pageSuccesses: number;
  readonly pageFailures: number;
  readonly parseSuccesses: number;
  readonly parseFailures: number;
  readonly parseFailureReasons: Record<string, number>;
  readonly jobs: number;
}

export type PlatformDiscovery = (
  platformName: string,
  signal?: AbortSignal,
  onDiagnostic?: (diagnostics: PlatformDiscoveryDiagnostics) => void
) => Promise<Job[]>;

/**
 * Public-search federation for the complete platform registry.
 * Network concurrency is four; there is deliberately no platform-count or
 * jobs-per-platform cap. Downstream deduplication and application safety rules
 * remain authoritative.
 */
export class PlatformSearchJobSource implements JobSource {
  readonly name = "platform-search-federation";

  constructor(
    private readonly platformDiscovery: PlatformDiscovery = discoverPlatform,
    private readonly onDiagnostic: (diagnostics: PlatformDiscoveryDiagnostics) => void = logDiagnostics
  ) {}

  async fetchJobs(signal?: AbortSignal): Promise<Job[]> {
    const platforms = JOB_PLATFORM_REGISTRY;
    if (!platforms.length) return [];
    const results = await mapWithConcurrency(platforms, SEARCH_CONCURRENCY, async (platform) => {
      if (signal?.aborted) return [];
      try {
        return await this.platformDiscovery(platform.name, signal, this.onDiagnostic);
      } catch (error) {
        this.onDiagnostic({
          platform: platform.name,
          searchPages: 0,
          searchReturnedUrls: 0,
          uniqueUrls: 0,
          pageSuccesses: 0,
          pageFailures: 0,
          parseSuccesses: 0,
          parseFailures: 0,
          parseFailureReasons: { exception: 1 },
          jobs: 0
        });
        return [];
      }
    });
    return results.flat();
  }
}

async function discoverPlatform(
  platformName: string,
  signal?: AbortSignal,
  onDiagnostic: (diagnostics: PlatformDiscoveryDiagnostics) => void = logDiagnostics
): Promise<Job[]> {
  const domain = platformSearchDomain(platformName);
  const queries = [
    `"${platformName}" (React OR "Frontend Engineer" OR "Front End Developer" OR Next.js OR TypeScript) (Bengaluru OR Bangalore OR India OR remote)`,
    domain
      ? `site:${domain} (React OR "Frontend Engineer" OR "Front End Developer" OR Next.js OR TypeScript) (Bengaluru OR Bangalore OR India OR remote)`
      : `"${platformName}" jobs (React OR "Frontend Engineer" OR Next.js OR TypeScript) (Bengaluru OR Bangalore OR India OR remote)`
  ];

  const pages = await mapWithConcurrency(queries, 2, async (query) => {
    if (signal?.aborted) return [];
    return fetchSearchPages(query, signal);
  });
  const searchPages = pages.flat();
  const rawUrls = searchPages.flatMap(extractSearchResultUrls);
  const links = [...new Set(rawUrls)];
  const diagnosticsBase = {
    platform: platformName,
    searchPages: searchPages.length,
    searchReturnedUrls: rawUrls.length,
    uniqueUrls: links.length
  };

  if (signal?.aborted) {
    onDiagnostic({ ...diagnosticsBase, pageSuccesses: 0, pageFailures: 0, parseSuccesses: 0, parseFailures: 0, parseFailureReasons: { aborted: 1 }, jobs: 0 });
    return [];
  }
  if (!links.length) {
    onDiagnostic({ ...diagnosticsBase, pageSuccesses: 0, pageFailures: 0, parseSuccesses: 0, parseFailures: 0, parseFailureReasons: {}, jobs: 0 });
    return [];
  }

  let pageSuccesses = 0;
  let pageFailures = 0;
  let parseSuccesses = 0;
  let parseFailures = 0;
  const parseFailureReasons: Record<string, number> = {};

  const jobs = await mapWithConcurrency(links, SEARCH_CONCURRENCY, async (url) => {
    if (signal?.aborted) return null;
    try {
      const html = await fetchText(url, PAGE_TIMEOUT_MS, signal);
      if (!html) { pageFailures += 1; return null; }
      pageSuccesses += 1;
      const parsed = parsePlatformJobPage(html, url, platformName);
      recordParseDiagnostic(parsed.diagnostics, parseFailureReasons);
      if (!parsed.job) { parseFailures += 1; return null; }
      parseSuccesses += 1;
      return parsed.job;
    } catch {
      pageFailures += 1;
      return null;
    }
  });

  const unique = new Map<string, Job>();
  for (const job of jobs) {
    if (!job) continue;
    const key = job.url.trim().toLowerCase();
    if (!unique.has(key)) unique.set(key, job);
  }
  onDiagnostic({ ...diagnosticsBase, pageSuccesses, pageFailures, parseSuccesses, parseFailures, parseFailureReasons, jobs: unique.size });
  return [...unique.values()];
}

function recordParseDiagnostic(diagnostic: JobPageDiagnostics, reasons: Record<string, number>): void {
  if (diagnostic.parsed) return;
  const reason = diagnostic.failure ?? "unknown";
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

function logDiagnostics(diagnostics: PlatformDiscoveryDiagnostics): void {
  console.info(JSON.stringify({ event: "platform_discovery_diagnostic", ...diagnostics }));
}

async function fetchSearchPages(query: string, signal?: AbortSignal): Promise<string[]> {
  const encoded = encodeURIComponent(query);
  const endpoints = [
    `https://r.jina.ai/https://www.google.com/search?q=${encoded}&gbv=1`,
    `https://r.jina.ai/https://www.bing.com/search?q=${encoded}`,
    `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encoded}`
  ];
  const pages: string[] = [];
  for (const endpoint of endpoints) {
    if (signal?.aborted) return pages;
    const page = await fetchText(endpoint, SEARCH_TIMEOUT_MS, signal);
    if (page) pages.push(page);
    if (pages.length >= 1) break;
  }
  if (pages.length || signal?.aborted) return pages;
  const bingRss = await fetchText(`https://www.bing.com/search?format=rss&q=${encoded}`, SEARCH_TIMEOUT_MS, signal);
  return bingRss ? [bingRss] : [];
}

function extractSearchResultUrls(page: string): string[] {
  const urls = new Set<string>();
  for (const match of page.matchAll(/\]\((https?:\/\/[^)\s]+)\)/gi)) {
    const url = cleanSearchUrl(match[1] ?? ""); if (url) urls.add(url);
  }
  for (const match of page.matchAll(/<link[^>]*>(https?:\/\/[^<]+)<\/link>/gi)) {
    const url = cleanSearchUrl(decodeXml(match[1] ?? "")); if (url) urls.add(url);
  }
  for (const match of page.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    const url = cleanSearchUrl(decodeXml(match[1] ?? "")); if (url) urls.add(url);
  }
  return [...urls].filter((url) => !isSearchEngineUrl(url));
}

function cleanSearchUrl(value: string): string {
  const decoded = decodeXml(value).replace(/&amp;/gi, "&").trim();
  try {
    const url = new URL(decoded);
    if (!/^https?:$/i.test(url.protocol) || isSearchEngineUrl(url.toString())) return "";
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}

function isSearchEngineUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "google.com" || hostname.endsWith(".google.com") || hostname === "bing.com" || hostname.endsWith(".bing.com") || hostname === "duckduckgo.com" || hostname.endsWith(".duckduckgo.com") || hostname === "microsoft.com" || hostname.endsWith(".microsoft.com") || hostname === "jina.ai" || hostname.endsWith(".jina.ai");
  } catch { return true; }
}

/** Known domains only. Never derive an employer domain from a platform name. */
function platformSearchDomain(platformName: string): string | null {
  const knownDomains: Record<string, string> = {
    Naukri: "naukri.com", "LinkedIn Jobs": "linkedin.com", "Indeed India": "in.indeed.com", Instahyre: "instahyre.com", Cutshort: "cutshort.io", Hirist: "hirist.tech", Foundit: "foundit.in", TimesJobs: "timesjobs.com", Shine: "shine.com", Wellfound: "wellfound.com", "Glassdoor India": "glassdoor.co.in", Internshala: "internshala.com", Unstop: "unstop.com", "Remote OK": "remoteok.com", "We Work Remotely": "weworkremotely.com", Himalayas: "himalayas.app", Jobicy: "jobicy.com", Remotive: "remotive.com", "Remote.co": "remote.co", "Working Nomads": "workingnomads.com", Jobspresso: "jobspresso.co", "Landing.jobs": "landing.jobs", "No Fluff Jobs": "nofluffjobs.com", "Y Combinator Jobs": "ycombinator.com", Greenhouse: "greenhouse.io", Lever: "lever.co", Ashby: "ashbyhq.com", Adzuna: "adzuna.com", Jooble: "jooble.org", JobStreet: "jobstreet.com", SEEK: "seek.com.au", MyCareersFuture: "mycareersfuture.gov.sg"
  };
  return knownDomains[platformName] ?? null;
}

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
}

async function fetchText(url: string, timeoutMs: number, parentSignal?: AbortSignal): Promise<string | null> {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    if (parentSignal?.aborted) return null;
    const controller = new AbortController();
    const onParentAbort = (): void => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept: "text/plain,text/html,application/xhtml+xml,application/rss+xml,application/ld+json,*/*;q=0.5", "user-agent": "job-agent-public-platform-discovery/3.0" } });
      if (response.ok) return await response.text();
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) return null;
    } catch {
      if (parentSignal?.aborted) return null;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
    if (attempt < FETCH_RETRIES) await delayWithSignal(RETRY_BASE_DELAY_MS * 2 ** attempt, parentSignal);
  }
  return null;
}

async function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const output: R[] = new Array(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      output[current] = await mapper(items[current] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker()));
  return output;
}
