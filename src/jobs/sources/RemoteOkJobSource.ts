import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError";
import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";

interface RemoteOkJob {
  id?: string | number;
  slug?: string;
  position?: string;
  company?: string;
  description?: string;
  url?: string;
  location?: string;
  date?: string;
  epoch?: number;
  tags?: string[];
  job_type?: string;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
}

export class RemoteOkJobSource implements JobSource {
  readonly name = "remoteok:json";

  constructor(private readonly feedUrl = "https://remoteok.com/api") {}

  async fetchJobs(): Promise<Job[]> {
    const response = await fetch(this.feedUrl, {
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      throw new AppError(`Remote OK request failed: ${response.status}`, {
        code: "JOB_SOURCE_REQUEST_FAILED",
        statusCode: response.status
      });
    }

    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) {
      throw new AppError("Remote OK returned an unexpected payload", {
        code: "JOB_SOURCE_INVALID_DATA",
        statusCode: 502
      });
    }

    // Remote OK's feed can contain non-job metadata records alongside jobs.
    // Ignore those records rather than allowing one malformed entry to abort the
    // entire discovery batch.
    return data
      .filter((item): item is RemoteOkJob => isJob(item))
      .map((job) => this.normalize(job));
  }

  private normalize(job: RemoteOkJob): Job {
    const title = job.position?.trim() ?? "";
    const url = job.url?.trim() || (job.slug ? `https://remoteok.com/remote-jobs/${job.slug}` : "");
    const description = stripHtml(job.description ?? "");

    if (!job.id || !title || !url || !description) {
      throw new AppError("Remote OK returned an incomplete job posting", {
        code: "JOB_SOURCE_INVALID_DATA",
        statusCode: 502
      });
    }

    const location = job.location?.trim() || "Worldwide";
    const companyName = job.company?.trim() || "Unknown";
    const postedAt = parseDate(job.date, job.epoch);
    const contentHash = createHash("sha256")
      .update([this.name, String(job.id), title, url, description].join("|"))
      .digest("hex");

    return {
      source: this.name,
      sourceJobId: String(job.id),
      url,
      title,
      companyName,
      location,
      country: inferCountry(location),
      workplaceType: "remote",
      employmentType: job.job_type?.trim() || null,
      description,
      postedAt,
      updatedAt: null,
      contentHash
    };
  }
}

function isJob(value: unknown): value is RemoteOkJob {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const item = value as Record<string, unknown>;
  const hasId = (typeof item.id === "string" && item.id.trim().length > 0)
    || (typeof item.id === "number" && Number.isFinite(item.id));
  const hasPosition = typeof item.position === "string" && item.position.trim().length > 0;
  const hasDescription = typeof item.description === "string" && stripHtml(item.description).length > 0;
  const hasUrl = typeof item.url === "string" && item.url.trim().length > 0;
  const hasSlug = typeof item.slug === "string" && item.slug.trim().length > 0;

  return hasId && hasPosition && hasDescription && (hasUrl || hasSlug);
}

function stripHtml(value: string): string {
  return decodeHtml(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function parseDate(value?: string, epoch?: number): Date | null {
  if (epoch !== undefined && Number.isFinite(epoch)) {
    const date = new Date(epoch * 1000);
    if (!Number.isNaN(date.getTime())) return date;
  }

  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function inferCountry(location: string | null): string | null {
  if (!location) return null;
  const normalized = location.toLowerCase();
  if (/india|bangalore|bengaluru|mumbai|pune|hyderabad|chennai|delhi|gurugram|noida/.test(normalized)) return "India";
  return null;
}
