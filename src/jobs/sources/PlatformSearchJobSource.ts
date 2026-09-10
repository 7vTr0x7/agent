import { createHash } from "node:crypto";
import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";
import { JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";

const SEARCH_CONCURRENCY = 4;
const SEARCH_TIMEOUT_MS = 8000;
const PAGE_TIMEOUT_MS = 8000;
const MAX_SEARCH_URLS_PER_QUERY = 20;
const FETCH_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 250;

/**
 * Public-search federation for registry platforms without a stable free API/feed.
 *
 * Important: this searches the complete registry every cycle. There is no
 * platform-count or jobs-per-platform cap here. Search engines and the public
 * job pages themselves remain the only external limits; downstream matching,
 * deduplication, queue capacity and application safety limits control processing.
 */
export class PlatformSearchJobSource implements JobSource {
  readonly name = "platform-search-federation";

  async fetchJobs(signal?: AbortSignal): Promise<Job[]> {
    const platforms = JOB_PLATFORM_REGISTRY;
    if (!platforms.length) return [];

    const results = await mapWithConcurrency(platforms, SEARCH_CONCURRENCY, async (platform) => {
      if (signal?.aborted) return [];
      try {
        return await discoverPlatform(platform.name, signal);
      } catch {
        return [];
      }
    });

    return results.flat();
  }
}

async function discoverPlatform(platformName: string, signal?: AbortSignal): Promise<Job[]> {
  const domain = platformSearchDomain(platformName);
  const queries = [
    `"${platformName}" (React OR "Frontend Engineer" OR "Front End Developer" OR Next.js OR TypeScript) (Bengaluru OR Bangalore OR India OR remote)`,
    domain
      ? `site:${domain} (React OR "Frontend Engineer" OR "Front End Developer" OR Next.js OR TypeScript) (Bengaluru OR Bangalore OR India OR remote)`
      : `"${platformName}" jobs (React OR "Frontend Engineer" OR Next.js OR TypeScript) (Bengaluru OR Bangalore OR India OR remote)`
  ];

  const searchResults = await mapWithConcurrency(queries, 2, async (query) => {
    if (signal?.aborted) return [];
    const responses = await fetchSearchPages(query, signal);
    return responses.flatMap(extractSearchResultUrls);
  });

  if (signal?.aborted) return [];
  const links = [...new Set(searchResults.flat())].slice(0, MAX_SEARCH_URLS_PER_QUERY * queries.length);
  if (!links.length) return [];

  const jobs = await mapWithConcurrency(links, SEARCH_CONCURRENCY, async (url) => {
    if (signal?.aborted) return null;
    try {
      const html = await fetchText(url, PAGE_TIMEOUT_MS, signal);
      return html ? parseJobPosting(html, url, platformName) : null;
    } catch {
      return null;
    }
  });

  const unique = new Map<string, Job>();
  for (const job of jobs) {
    if (!job) continue;
    const key = job.url.trim().toLowerCase();
    if (!unique.has(key)) unique.set(key, job);
  }
  return [...unique.values()];
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

  const bingRss = await fetchText(
    `https://www.bing.com/search?format=rss&q=${encoded}`,
    SEARCH_TIMEOUT_MS,
    signal
  );
  return bingRss ? [bingRss] : [];
}

function extractSearchResultUrls(page: string): string[] {
  const urls = new Set<string>();

  for (const match of page.matchAll(/\]\((https?:\/\/[^)\s]+)\)/gi)) {
    const url = cleanSearchUrl(match[1] ?? "");
    if (url) urls.add(url);
  }

  for (const match of page.matchAll(/<link[^>]*>(https?:\/\/[^<]+)<\/link>/gi)) {
    const url = cleanSearchUrl(decodeXml(match[1] ?? ""));
    if (url) urls.add(url);
  }
  for (const match of page.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)) {
    const url = cleanSearchUrl(decodeXml(match[1] ?? ""));
    if (url) urls.add(url);
  }

  return [...urls].filter((url) => !isSearchEngineUrl(url));
}

function cleanSearchUrl(value: string): string {
  const decoded = decodeXml(value).replace(/&amp;/gi, "&").trim();
  try {
    const url = new URL(decoded);
    if (!/^https?:$/i.test(url.protocol)) return "";
    if (isSearchEngineUrl(url.toString())) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function isSearchEngineUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "google.com" || hostname.endsWith(".google.com") ||
      hostname === "bing.com" || hostname.endsWith(".bing.com") ||
      hostname === "duckduckgo.com" || hostname.endsWith(".duckduckgo.com") ||
      hostname === "microsoft.com" || hostname.endsWith(".microsoft.com") ||
      hostname === "jina.ai" || hostname.endsWith(".jina.ai");
  } catch {
    return true;
  }
}

/** Known domains only. We never invent a domain from a platform display name. */
function platformSearchDomain(platformName: string): string | null {
  const knownDomains: Record<string, string> = {
    Naukri: "naukri.com",
    "LinkedIn Jobs": "linkedin.com",
    "Indeed India": "in.indeed.com",
    Instahyre: "instahyre.com",
    Cutshort: "cutshort.io",
    Hirist: "hirist.tech",
    Foundit: "foundit.in",
    TimesJobs: "timesjobs.com",
    Shine: "shine.com",
    Wellfound: "wellfound.com",
    "Glassdoor India": "glassdoor.co.in",
    Internshala: "internshala.com",
    Unstop: "unstop.com",
    "Remote OK": "remoteok.com",
    "We Work Remotely": "weworkremotely.com",
    Himalayas: "himalayas.app",
    Jobicy: "jobicy.com",
    Remotive: "remotive.com",
    "Remote.co": "remote.co",
    "Working Nomads": "workingnomads.com",
    Jobspresso: "jobspresso.co",
    "Landing.jobs": "landing.jobs",
    "No Fluff Jobs": "nofluffjobs.com",
    "Y Combinator Jobs": "ycombinator.com",
    Greenhouse: "greenhouse.io",
    Lever: "lever.co",
    Ashby: "ashbyhq.com",
    Adzuna: "adzuna.com",
    Jooble: "jooble.org",
    JobStreet: "jobstreet.com",
    SEEK: "seek.com.au",
    MyCareersFuture: "mycareersfuture.gov.sg"
  };
  return knownDomains[platformName] ?? null;
}

function parseJobPosting(html: string, sourceUrl: string, platformName: string): Job | null {
  const values = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((m) => parseJsonLd(m[1] ?? ""));

  const postings = values.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const graph = Array.isArray(item["@graph"]) ? item["@graph"] : [item];
    return graph
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
      .filter((entry) => {
        const type = entry["@type"];
        return Array.isArray(type)
          ? type.some((v) => String(v).toLowerCase() === "jobposting")
          : String(type ?? "").toLowerCase() === "jobposting";
      });
  });

  const posting = postings[0];
  if (!posting) return null;

  const title = stringValue(posting.title);
  const description = stripHtml(stringValue(posting.description));
  const url = stringValue(posting.url) || sourceUrl;
  const hiring = posting.hiringOrganization as Record<string, unknown> | undefined;
  const companyName = stringValue(hiring?.name) || stringValue(posting.organization);
  const companyDomain = companyDomainFromOrganization(hiring?.sameAs ?? hiring?.url);
  const location = parseLocation(posting.jobLocation) || stringValue(posting.jobLocationType) || "Worldwide";
  const workplaceType: Job["workplaceType"] = /telecommute|remote/i.test(`${posting.jobLocationType ?? ""} ${location}`)
    ? "remote"
    : /hybrid/i.test(location)
      ? "hybrid"
      : "onsite";

  if (!title || !description || !url || !companyName) return null;

  const sourceJobId = `${platformName}:${url}`;
  const contentHash = createHash("sha256")
    .update([platformName, sourceJobId, title, url, description].join("|"), "utf8")
    .digest("hex");

  return {
    source: `platform-search:${platformName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    sourceJobId,
    url,
    title,
    companyName,
    companyDomain,
    location,
    country: inferCountry(location),
    workplaceType,
    employmentType: stringValue(posting.employmentType) || null,
    description,
    postedAt: parseDate(posting.datePosted),
    updatedAt: parseDate(posting.dateModified),
    contentHash
  };
}

function parseJsonLd(raw: string): unknown[] {
  try {
    const value = JSON.parse(raw.trim().replace(/<!--|-->/g, ""));
    return Array.isArray(value) ? value : [value];
  } catch {
    return [];
  }
}

function parseLocation(value: unknown): string | null {
  const items = Array.isArray(value) ? value : [value];
  const parts = items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const address = record.address as Record<string, unknown> | undefined;
    const text = [
      stringValue(address?.addressLocality),
      stringValue(address?.addressRegion),
      stringValue(address?.addressCountry)
    ].filter(Boolean).join(", ");
    return text ? [text] : [];
  });
  return parts.join("; ") || null;
}

function companyDomainFromOrganization(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value.find((v) => typeof v === "string") : value;
  if (typeof candidate !== "string" || !candidate.trim()) return null;
  try {
    return new URL(candidate).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function inferCountry(location: string | null): string | null {
  const s = (location ?? "").toLowerCase();
  if (/india|bangalore|bengaluru|mumbai|pune|hyderabad|chennai|delhi|gurugram|noida/.test(s)) return "India";
  if (/singapore/.test(s)) return "Singapore";
  if (/japan|tokyo|osaka|kyoto/.test(s)) return "Japan";
  if (/united states|\busa\b|u\.s\./.test(s)) return "United States";
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function stripHtml(value: string): string {
  return decodeXml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

async function fetchText(url: string, timeoutMs: number, parentSignal?: AbortSignal): Promise<string | null> {
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    if (parentSignal?.aborted) return null;

    const controller = new AbortController();
    const onParentAbort = (): void => controller.abort(parentSignal?.reason);
    parentSignal?.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          accept: "text/plain,text/html,application/xhtml+xml,application/rss+xml,application/ld+json,*/*;q=0.5",
          "user-agent": "job-agent-public-platform-discovery/2.0"
        }
      });
      if (response.ok) return await response.text();
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status)) return null;
    } catch {
      if (parentSignal?.aborted) return null;
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }

    if (attempt < FETCH_RETRIES) {
      await delayWithSignal(RETRY_BASE_DELAY_MS * 2 ** attempt, parentSignal);
    }
  }
  return null;
}

async function delayWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
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

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, () => worker())
  );
  return output;
}
