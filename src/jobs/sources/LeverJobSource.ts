import { createHash } from "node:crypto";
import { AppError } from "../../shared/errors/AppError";
import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";

interface LeverPosting {
  id: string;
  text: string;
  createdAt?: number;
  updatedAt?: number;
  country?: string;
  workplaceType?: string;
  categories?: { location?: string; commitment?: string };
  content?: { description?: string };
  state?: string;
  urls?: { show?: string };
}
interface LeverResponse { data?: LeverPosting[]; hasNext?: boolean; next?: string; }

export class LeverJobSource implements JobSource {
  readonly name = "lever";
  constructor(
    private readonly companySlug: string,
    private readonly baseUrl = "https://api.lever.co/v0/postings",
    private readonly companyDomain?: string
  ) {}

  async fetchJobs(): Promise<Job[]> {
    const url = `${this.baseUrl}/${encodeURIComponent(this.companySlug)}?mode=json`;
    const response = await fetch(url);
    if (!response.ok) throw new AppError(`Lever request failed: ${response.status}`, { code: "JOB_SOURCE_REQUEST_FAILED", statusCode: 502 });
    const data = (await response.json()) as LeverPosting[] | LeverResponse;
    const postings = Array.isArray(data) ? data : (data.data ?? []);
    return postings.filter((posting) => posting.state === undefined || posting.state === "published").map((posting) => this.normalize(posting));
  }

  private normalize(posting: LeverPosting): Job {
    const description = posting.content?.description?.trim() ?? "";
    if (!posting.id || !posting.text || !description || !posting.urls?.show) throw new AppError("Lever returned an incomplete job posting", { code: "JOB_SOURCE_INVALID_DATA", statusCode: 502 });
    const contentHash = createHash("sha256").update([this.name, this.companySlug, posting.id, posting.text, posting.urls.show, description].join("|")).digest("hex");
    return {
      source: this.name, sourceJobId: posting.id, url: posting.urls.show, title: posting.text.trim(), companyName: this.companySlug,
      ...(this.companyDomain ? { companyDomain: this.companyDomain } : {}),
      location: posting.categories?.location?.trim() || null, country: posting.country?.trim() || null,
      workplaceType: posting.workplaceType === "remote" || posting.workplaceType === "hybrid" || posting.workplaceType === "onsite" ? posting.workplaceType : null,
      employmentType: posting.categories?.commitment?.trim() || null, description,
      postedAt: posting.createdAt ? new Date(posting.createdAt) : null, updatedAt: posting.updatedAt ? new Date(posting.updatedAt) : null, contentHash
    };
  }
}
