import { Job } from "../domain/Job";
import { createHash } from "node:crypto";

interface JobPostingJsonLd {
  "@type"?: string | string[];
  title?: string;
  name?: string;
  description?: string;
  url?: string;
  datePosted?: string;
  dateModified?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string; url?: string } | string;
  jobLocation?: unknown;
  applicantLocationRequirements?: unknown;
  jobLocationType?: string;
}

export interface StructuredDataJobSourceOptions {
  readonly id: string;
  readonly url: string;
  readonly defaultCompanyName?: string;
  readonly companyDomain?: string;
  readonly timeoutMs?: number;
}

/**
 * Reads public pages that expose Schema.org JobPosting JSON-LD.
 * It intentionally does not log in, bypass CAPTCHAs, evade bot controls,
 * or execute site-specific anti-bot workarounds.
 */
export class StructuredDataJobSource {
  readonly name: string;

  constructor(private readonly options: StructuredDataJobSourceOptions) {
    this.name = options.id;
  }

  async fetchJobs(): Promise<Job[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);
    try {
      const response = await fetch(this.options.url, {
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent": "job-agent-public-discovery/1.0"
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} while fetching ${this.options.url}`);
      const html = await response.text();
      return extractJobs(html, this.options);
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractJobs(html: string, options: StructuredDataJobSourceOptions): Job[] {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const jobs: Job[] = [];
  const seen = new Set<string>();

  for (const match of scripts) {
    const json = match[1];
    if (json === undefined) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeHtml(json));
    } catch {
      continue;
    }

    for (const item of flattenJsonLd(parsed)) {
      if (!isJobPosting(item)) continue;
      const job = toJob(item, options);
      if (!job || seen.has(job.sourceJobId)) continue;
      seen.add(job.sourceJobId);
      jobs.push(job);
    }
  }

  return jobs;
}

function flattenJsonLd(value: unknown): JobPostingJsonLd[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const graph = object["@graph"];
  const current = object as JobPostingJsonLd;
  return graph ? [current, ...flattenJsonLd(graph)] : [current];
}

function isJobPosting(item: JobPostingJsonLd): boolean {
  const type = item["@type"];
  return Array.isArray(type) ? type.some((entry) => entry.toLowerCase() === "jobposting") : type?.toLowerCase() === "jobposting";
}

function toJob(item: JobPostingJsonLd, options: StructuredDataJobSourceOptions): Job | null {
  const title = clean(item.title ?? item.name);
  const description = clean(item.description);
  const url = clean(item.url) ?? options.url;
  const companyName = typeof item.hiringOrganization === "string"
    ? clean(item.hiringOrganization)
    : clean(item.hiringOrganization?.name) ?? options.defaultCompanyName;
  if (!title || !description || !companyName || !url) return null;

  const sourceJobId = createHash("sha256").update(`${companyName}|${title}|${url}`).digest("hex").slice(0, 40);
  const location = locationText(item.jobLocation);
  const country = locationCountry(item.jobLocation);
  const workplaceType = item.jobLocationType?.toLowerCase().includes("telecommute") ? "remote" : null;
  const employmentType = Array.isArray(item.employmentType) ? item.employmentType.join(", ") : item.employmentType ?? null;

  return {
    source: options.id,
    sourceJobId,
    url,
    title,
    companyName,
    companyDomain: options.companyDomain ?? null,
    location,
    country,
    workplaceType,
    employmentType,
    description,
    postedAt: parseDate(item.datePosted),
    updatedAt: parseDate(item.dateModified),
    contentHash: createHash("sha256").update(`${title}|${companyName}|${description}`).digest("hex")
  };
}

function locationText(value: unknown): string | null {
  if (!value) return null;
  const values = Array.isArray(value) ? value : [value];
  const texts = values.map((entry) => {
    if (!entry || typeof entry !== "object") return String(entry);
    const address = (entry as Record<string, unknown>).address;
    if (!address || typeof address !== "object") return null;
    const a = address as Record<string, unknown>;
    return [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(", ") || null;
  }).filter((entry): entry is string => Boolean(entry));
  return texts.length ? [...new Set(texts)].join("; ") : null;
}

function locationCountry(value: unknown): string | null {
  const text = locationText(value);
  return text?.split(", ").pop() ?? null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clean(value: string | undefined | null): string | null {
  if (!value) return null;
  const stripped = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return stripped || null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#38;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
