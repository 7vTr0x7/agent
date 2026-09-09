import { createHash } from "node:crypto";
import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";
import { JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";

const SEARCH_CONCURRENCY = 4;
const SEARCH_TIMEOUT_MS = 8000;
const PAGE_TIMEOUT_MS = 8000;
const MAX_SEARCH_URLS_PER_QUERY = 20;

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

  async fetchJobs(): Promise<Job[]> {
    const platforms = JOB_PLATFORM_REGISTRY;
    if (!platforms.length) return [];

    const results = await mapWithConcurrency(platforms, SEARCH_CONCURRENCY, async (platform) => {
      try {
        return await discoverPlatform(platform.name);
      } catch {
        return [];
      }
    });

    return results.flat();
  }
}

async function discoverPlatform(platformName: string): Promise<Job[]> {
  const domain = platformSearchDomain(platformName);
  const queries = [
    `"${platformName}" (React OR "Frontend Engineer" OR "Front End Developer" OR Next.js OR TypeScript) (Bengaluru OR Bangalore OR India OR remote)`,
    domain
      ? `site:${domain} (React OR "Frontend Engineer" OR "Front End Developer" OR Next.js OR TypeScript) (Bengaluru OR Bangalore OR India OR remote)`
      : `"${platformName}" jobs (React OR "Frontend Engineer" OR Next.js OR TypeScript) (Bengaluru OR Bangalore OR India OR remote)`
  ];

  // Use several public search front-ends. Jina provides a stable text/HTML
  // representation of search pages and avoids depending on a particular RSS
  // response format. Direct Bing RSS remains a final fallback when Jina is
  // unavailable. We never bypass login, CAPTCHA, robots or access controls.
  const searchResults = await mapWithConcurrency(queries, 2, async (query) => {
    const responses = await fetchSearchPages(query);
    return responses.flatMap(extractSearchResultUrls);
  });

  const links = [...new Set(searchResults.flat())].slice(0, MAX_SEARCH_URLS_PER_QUERY * queries.length);
  if (!links.length) return [];

  const jobs = await mapWithConcurrency(links, SEARCH_CONCURRENCY, async (url) => {
    try {
      const html = await fetchText(url, PAGE_TIMEOUT_MS);
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

async function fetchSearchPages(query: string): Promise<string[]> {
  const encoded = encodeURIComponent(query);
  const endpoints = [
    `https://r.jina.ai/https://www.google.com/search?q=${encoded}&gbv=1`,
    `https://r.jina.ai/https://www.bing.com/search?q=${encoded}`,
    `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encoded}`
  ];

  const pages: string[] = [];
  for (const endpoint of endpoints) {
    const page = await fetchText(endpoint, SEARCH_TIMEOUT_MS);
    if (page) pages.push(page);
    // One healthy search representation is normally enough. This prevents a
    // single discovery cycle from multiplying requests against public engines.
    if (pages.length >= 1) break;
  }

  if (pages.length) return pages;

  const bingRss = await fetchText(
    `https://www.bing.com/search?format=rss&q=${encoded}`,
    SEARCH_TIMEOUT_MS
  );
  return bingRss ? [bingRss] : [];
}

function extractSearchResultUrls(page: string): string[] {
  const urls = new Set<string>();

  // Jina search output commonly uses Markdown links.
  for (const match of page.matchAll(/\]\((https?:\/\/[^)\s]+)\)/gi)) {
    const url = cleanSearchUrl(match[1] ?? "");
    if (url) urls.add(url);
  }

  // Also accept ordinary HTML/XML links for fallback search responses.
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
    // Do not crawl javascript/data/blob URLs or obvious search/redirect links.
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

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/plain,text/html,application/xhtml+xml,application/rss+xml,application/ld+json,*/*;q=0.5",
        "user-agent": "job-agent-public-platform-discovery/2.0"
      }
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
