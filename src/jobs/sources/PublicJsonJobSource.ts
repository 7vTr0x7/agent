import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError";
import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";

type PublicJsonProvider = "himalayas" | "jobicy" | "arbeitnow";

export class PublicJsonJobSource implements JobSource {
  readonly name: string;

  constructor(
    private readonly provider: PublicJsonProvider,
    private readonly feedUrl: string,
    private readonly defaultCountry: string | null = null
  ) {
    this.name = `${provider}:json`;
  }

  async fetchJobs(): Promise<Job[]> {
    const response = await fetch(this.feedUrl, { headers: { accept: "application/json" } });
    if (!response.ok) {
      throw new AppError(`${this.provider} request failed: ${response.status}`, {
        code: "JOB_SOURCE_REQUEST_FAILED",
        statusCode: response.status
      });
    }

    const payload = (await response.json()) as unknown;
    const records = this.provider === "himalayas"
      ? readHimalayas(payload)
      : this.provider === "jobicy"
        ? readJobicy(payload)
        : readArbeitnow(payload);
    return records.map((record) => this.normalize(record));
  }

  private normalize(record: NormalizedPublicJob): Job {
    const title = record.title.trim();
    const url = record.url.trim();
    const description = stripHtml(record.description);
    const companyName = record.companyName.trim() || "Unknown";
    const location = record.location?.trim() || "Worldwide";

    if (!record.id || !title || !url || !description) {
      throw new AppError(`${this.provider} returned an incomplete job posting`, {
        code: "JOB_SOURCE_INVALID_DATA",
        statusCode: 502
      });
    }

    const contentHash = createHash("sha256")
      .update([this.name, record.id, title, url, description].join("|"))
      .digest("hex");

    return {
      source: this.name,
      sourceJobId: record.id,
      url,
      title,
      companyName,
      location,
      country: record.country ?? this.defaultCountry ?? inferCountry(location),
      workplaceType: record.workplaceType ?? "remote",
      employmentType: record.employmentType ?? null,
      description,
      postedAt: parseDate(record.postedAt),
      updatedAt: parseDate(record.updatedAt),
      contentHash
    };
  }
}

interface NormalizedPublicJob {
  id: string;
  title: string;
  url: string;
  companyName: string;
  location?: string | null;
  country?: string | null;
  workplaceType?: "onsite" | "remote" | "hybrid" | null;
  employmentType?: string | null;
  description: string;
  postedAt?: string | number | null;
  updatedAt?: string | number | null;
}

function readHimalayas(payload: unknown): NormalizedPublicJob[] {
  const jobs = objectArray(payload, "jobs");
  return jobs.flatMap((job) => {
    const item = job as Record<string, unknown>;
    const id = stringValue(item.guid);
    const title = stringValue(item.title);
    const url = stringValue(item.applicationLink);
    const description = stringValue(item.description) || stringValue(item.excerpt);
    const countries = Array.isArray(item.locationRestrictions) ? item.locationRestrictions.filter((v): v is string => typeof v === "string") : [];
    return id && title && url && description
      ? [{ id, title, url, companyName: stringValue(item.companyName) || "Unknown", location: countries.join(", ") || "Worldwide", country: countries.length === 1 ? countries[0] : null, employmentType: stringValue(item.employmentType) || null, description, postedAt: item.pubDate as string | number | null, updatedAt: null }]
      : [];
  });
}

function readJobicy(payload: unknown): NormalizedPublicJob[] {
  const jobs = objectArray(payload, "jobs");
  return jobs.flatMap((job) => {
    const item = job as Record<string, unknown>;
    const id = stringValue(item.id) || stringValue(item.jobSlug) || stringValue(item.url);
    const title = stringValue(item.jobTitle) || stringValue(item.title);
    const url = stringValue(item.url) || stringValue(item.jobUrl);
    const description = stringValue(item.jobDescription) || stringValue(item.description);
    const location = stringValue(item.jobGeo) || stringValue(item.location) || "Worldwide";
    return id && title && url && description
      ? [{ id, title, url, companyName: stringValue(item.companyName) || stringValue(item.company) || "Unknown", location, country: inferCountry(location), employmentType: stringValue(item.jobType) || stringValue(item.employmentType) || null, description, postedAt: item.pubDate as string | number | null, updatedAt: item.updatedAt as string | number | null }]
      : [];
  });
}

function readArbeitnow(payload: unknown): NormalizedPublicJob[] {
  const jobs = objectArray(payload, "data");
  return jobs.flatMap((job) => {
    const item = job as Record<string, unknown>;
    const id = stringValue(item.slug) || stringValue(item.url);
    const title = stringValue(item.title);
    const url = stringValue(item.url);
    const description = stringValue(item.description);
    const location = stringValue(item.location) || "Worldwide";
    const remote = item.remote === true;
    const workplaceType = remote ? "remote" : "onsite";
    return id && title && url && description
      ? [{ id, title, url, companyName: stringValue(item.company_name) || "Unknown", location, country: inferCountry(location), workplaceType, employmentType: firstString(item.job_types), description, postedAt: item.created_at as string | number | null, updatedAt: null }]
      : [];
  });
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === "string" && item.trim().length > 0);
    return first?.trim() ?? null;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function objectArray(payload: unknown, field: string): unknown[] {
  if (!payload || typeof payload !== "object") {
    throw new AppError("Job source returned an unexpected payload", { code: "JOB_SOURCE_INVALID_DATA", statusCode: 502 });
  }
  const value = (payload as Record<string, unknown>)[field];
  if (!Array.isArray(value)) {
    throw new AppError("Job source returned an unexpected jobs payload", { code: "JOB_SOURCE_INVALID_DATA", statusCode: 502 });
  }
  return value.filter((item) => item && typeof item === "object" && !Array.isArray(item));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function stripHtml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(value?: string | number | null): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = typeof value === "number" ? new Date(value < 10_000_000_000 ? value * 1000 : value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inferCountry(location: string | null): string | null {
  if (!location) return null;
  const normalized = location.toLowerCase();
  if (/india|bangalore|bengaluru|mumbai|pune|hyderabad|chennai|delhi|gurugram|noida/.test(normalized)) return "India";
  if (/singapore/.test(normalized)) return "Singapore";
  if (/japan|tokyo|osaka|kyoto/.test(normalized)) return "Japan";
  if (/united states|\busa\b|u\.s\.|america/.test(normalized)) return "United States";
  if (/germany|berlin|munich|münchen|hamburg|frankfurt|cologne|köln/.test(normalized)) return "Germany";
  if (/united kingdom|\buk\b|london|england|scotland|wales/.test(normalized)) return "United Kingdom";
  return null;
}
