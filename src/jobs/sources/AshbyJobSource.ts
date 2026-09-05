import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError";
import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";

interface AshbyJob {
  id: string;
  title: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
  publishedAt?: string;
  jobUrl?: string;
  location?: string;
  workplaceType?: string;
  employmentType?: string;
}

interface AshbyResponse {
  jobs?: AshbyJob[];
}

export class AshbyJobSource implements JobSource {
  readonly name: string;

  constructor(
    private readonly jobBoardName: string,
    private readonly baseUrl = "https://api.ashbyhq.com/posting-api/job-board"
  ) {
    this.name = `ashby:${jobBoardName}`;
  }

  async fetchJobs(): Promise<Job[]> {
    const url = `${this.baseUrl}/${encodeURIComponent(this.jobBoardName)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new AppError(`Ashby request failed: ${response.status}`, {
        code: "JOB_SOURCE_REQUEST_FAILED",
        statusCode: 502
      });
    }
    const data = (await response.json()) as AshbyResponse;
    return (data.jobs ?? []).map((job) => this.normalize(job));
  }

  private normalize(job: AshbyJob): Job {
    const description = (job.descriptionPlain ?? stripHtml(job.descriptionHtml ?? "")).trim();
    const url = job.jobUrl?.trim();
    if (!job.id || !job.title?.trim() || !description || !url) {
      throw new AppError("Ashby returned an incomplete job posting", {
        code: "JOB_SOURCE_INVALID_DATA",
        statusCode: 502
      });
    }
    const location = job.location?.trim() || null;
    const workplaceType = normalizeWorkplaceType(job.workplaceType, location, description);
    const contentHash = createHash("sha256")
      .update([this.name, job.id, job.title.trim(), url, description].join("|"))
      .digest("hex");
    return {
      source: this.name,
      sourceJobId: job.id,
      url,
      title: job.title.trim(),
      companyName: this.jobBoardName,
      location,
      country: inferCountry(location),
      workplaceType,
      employmentType: job.employmentType?.trim() || null,
      description,
      postedAt: job.publishedAt ? new Date(job.publishedAt) : null,
      updatedAt: null,
      contentHash
    };
  }
}

function normalizeWorkplaceType(value: string | undefined, location: string | null, description: string): Job["workplaceType"] {
  const explicit = value?.toLowerCase();
  if (explicit === "remote" || explicit === "hybrid" || explicit === "onsite") return explicit;
  const text = `${location ?? ""} ${description}`.toLowerCase();
  if (/\bremote\b|work from home|wfh/.test(text)) return "remote";
  if (/\bhybrid\b/.test(text)) return "hybrid";
  if (location) return "onsite";
  return null;
}

function inferCountry(location: string | null): string | null {
  if (!location) return null;
  const normalized = location.toLowerCase();
  if (/india|bangalore|bengaluru|mumbai|pune|hyderabad|chennai|delhi|gurugram|noida/.test(normalized)) return "India";
  return null;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}
