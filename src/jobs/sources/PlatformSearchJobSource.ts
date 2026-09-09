import { createHash } from "node:crypto";
import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";
import { JOB_PLATFORM_REGISTRY } from "./JobPlatformRegistry";

/** Public-search federation for platforms without a stable free API/feed. */
export class PlatformSearchJobSource implements JobSource {
  readonly name = "platform-search-federation";
  private cursor = 0;
  constructor(private readonly batchSize = 20, private readonly maxJobsPerPlatform = 3) {}

  async fetchJobs(): Promise<Job[]> {
    const platforms = JOB_PLATFORM_REGISTRY;
    if (!platforms.length) return [];
    const batch = Array.from({ length: Math.min(this.batchSize, platforms.length) }, (_, i) => platforms[(this.cursor + i) % platforms.length]).filter(Boolean);
    this.cursor = (this.cursor + batch.length) % platforms.length;
    const results = await mapWithConcurrency(batch, 4, async (platform) => {
      try { return await discoverPlatform(platform.name, this.maxJobsPerPlatform); } catch { return []; }
    });
    return results.flat();
  }
}

async function discoverPlatform(platformName: string, maxJobs: number): Promise<Job[]> {
  const query = `"${platformName}" (React OR "Frontend Engineer" OR "Front End Developer" OR Next.js OR TypeScript) (Bengaluru OR Bangalore OR India OR remote)`;
  const xml = await fetchText(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, 7000);
  if (!xml) return [];
  const links = [...xml.matchAll(/<link>(https?:\/\/[^<]+)<\/link>/gi)].map(m => decodeXml(m[1] ?? "")).filter(u => /^https?:\/\//i.test(u) && !/bing\.com|microsoft\.com/i.test(u)).slice(0, maxJobs * 2);
  const jobs = await mapWithConcurrency([...new Set(links)], 4, async url => {
    try { const html = await fetchText(url, 6000); return html ? parseJobPosting(html, url, platformName) : null; } catch { return null; }
  });
  return jobs.filter((job): job is Job => Boolean(job)).slice(0, maxJobs);
}

function parseJobPosting(html: string, sourceUrl: string, platformName: string): Job | null {
  const values = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap(m => parseJsonLd(m[1] ?? ""));
  const postings = values.flatMap(value => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const graph = Array.isArray(item["@graph"]) ? item["@graph"] : [item];
    return graph.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)).filter(entry => String(entry["@type"] ?? "").toLowerCase() === "jobposting");
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
  const workplaceType = /telecommute|remote/i.test(`${posting.jobLocationType ?? ""} ${location}`) ? "remote" : /hybrid/i.test(location) ? "hybrid" : "onsite";
  if (!title || !description || !url || !companyName) return null;
  const sourceJobId = `${platformName}:${url}`;
  const contentHash = createHash("sha256").update([platformName, sourceJobId, title, url, description].join("|"), "utf8").digest("hex");
  return { source: `platform-search:${platformName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, sourceJobId, url, title, companyName, companyDomain, location, country: inferCountry(location), workplaceType, employmentType: stringValue(posting.employmentType) || null, description, postedAt: parseDate(posting.datePosted), updatedAt: parseDate(posting.dateModified), contentHash };
}

function parseJsonLd(raw: string): unknown[] { try { const value = JSON.parse(raw.trim().replace(/<!--|-->/g, "")); return Array.isArray(value) ? value : [value]; } catch { return []; } }
function parseLocation(value: unknown): string | null { const items = Array.isArray(value) ? value : [value]; const parts = items.flatMap(item => { if (!item || typeof item !== "object") return []; const address = (item as Record<string, unknown>).address as Record<string, unknown> | undefined; const text = [stringValue(address?.addressLocality), stringValue(address?.addressRegion), stringValue(address?.addressCountry)].filter(Boolean).join(", "); return text ? [text] : []; }); return parts.join("; ") || null; }
function companyDomainFromOrganization(value: unknown): string | null { const candidate = Array.isArray(value) ? value.find(v => typeof v === "string") : value; if (typeof candidate !== "string" || !candidate.trim()) return null; try { return new URL(candidate).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } }
function inferCountry(location: string | null): string | null { const s = (location ?? "").toLowerCase(); if (/india|bangalore|bengaluru|mumbai|pune|hyderabad|chennai|delhi|gurugram|noida/.test(s)) return "India"; if (/singapore/.test(s)) return "Singapore"; if (/japan|tokyo|osaka|kyoto/.test(s)) return "Japan"; if (/united states|\busa\b|u\.s\./.test(s)) return "United States"; return null; }
function parseDate(value: unknown): Date | null { if (typeof value !== "string" && typeof value !== "number") return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function stringValue(value: unknown): string { return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim(); }
function stripHtml(value: string): string { return decodeXml(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function decodeXml(value: string): string { return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'"); }
async function fetchText(url: string, timeoutMs: number): Promise<string | null> { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); try { const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept: "application/rss+xml, application/ld+json, text/html;q=0.9, */*;q=0.5", "user-agent": "job-agent-public-platform-discovery/1.0" } }); if (!response.ok) return null; return await response.text(); } catch { return null; } finally { clearTimeout(timer); } }
async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> { const output: R[] = []; let index = 0; async function worker(): Promise<void> { while (true) { const current = index++; if (current >= items.length) return; output[current] = await mapper(items[current] as T); } } await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker())); return output; }
