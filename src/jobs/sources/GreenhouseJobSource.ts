import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError";
import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";

interface GreenhouseJob { id: number; title: string; updated_at?: string; absolute_url?: string; content?: string; location?: { name?: string }; }
interface GreenhouseResponse { jobs?: GreenhouseJob[]; }

export class GreenhouseJobSource implements JobSource {
  readonly name: string;
  constructor(
    private readonly boardToken: string,
    private readonly baseUrl = "https://boards-api.greenhouse.io/v1/boards",
    private readonly companyDomain?: string
  ) { this.name = `greenhouse:${boardToken}`; }

  async fetchJobs(): Promise<Job[]> {
    const url = `${this.baseUrl}/${encodeURIComponent(this.boardToken)}/jobs?content=true`;
    const response = await fetch(url);
    if (!response.ok) throw new AppError(`Greenhouse request failed: ${response.status}`, { code: "JOB_SOURCE_REQUEST_FAILED", statusCode: 502 });
    const data = (await response.json()) as GreenhouseResponse;
    return (data.jobs ?? []).map((job) => this.normalize(job));
  }

  private normalize(job: GreenhouseJob): Job {
    const description = stripHtml(job.content ?? "");
    const url = job.absolute_url?.trim();
    if (!job.id || !job.title?.trim() || !description || !url) throw new AppError("Greenhouse returned an incomplete job posting", { code: "JOB_SOURCE_INVALID_DATA", statusCode: 502 });
    const location = job.location?.name?.trim() || null;
    const contentHash = createHash("sha256").update([this.name, job.id, job.title.trim(), url, description].join("|")).digest("hex");
    return {
      source: this.name, sourceJobId: String(job.id), url, title: job.title.trim(), companyName: this.boardToken,
      ...(this.companyDomain ? { companyDomain: this.companyDomain } : {}),
      location, country: inferCountry(location), workplaceType: inferWorkplaceType(location, description), employmentType: null,
      description, postedAt: null, updatedAt: job.updated_at ? new Date(job.updated_at) : null, contentHash
    };
  }
}
function stripHtml(value: string): string { return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim(); }
function inferWorkplaceType(location: string | null, description: string): Job["workplaceType"] { const text = `${location ?? ""} ${description}`.toLowerCase(); if (/\bremote\b|work from home|wfh/.test(text)) return "remote"; if (/\bhybrid\b/.test(text)) return "hybrid"; if (location) return "onsite"; return null; }
function inferCountry(location: string | null): string | null { if (!location) return null; const normalized = location.toLowerCase(); if (/india|bangalore|bengaluru|mumbai|pune|hyderabad|chennai|delhi|gurugram|noida/.test(normalized)) return "India"; return null; }
