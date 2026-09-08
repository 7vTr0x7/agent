import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";

export interface AdzunaJobSourceOptions {
  appId: string;
  appKey: string;
  countryCode: string;
  pages?: number;
  resultsPerPage?: number;
  queries?: readonly string[];
  locations?: readonly string[];
}

interface AdzunaResponse { results?: Array<Record<string, unknown>>; }

export class AdzunaJobSource implements JobSource {
  readonly name = "adzuna";
  constructor(private readonly options: AdzunaJobSourceOptions) {}

  async fetchJobs(): Promise<Job[]> {
    const jobs: Job[] = [];
    const queries = this.options.queries?.length ? this.options.queries : [""];
    const locations = this.options.locations?.length ? this.options.locations : [""];
    for (const query of queries) for (const location of locations) {
      for (let page = 1; page <= (this.options.pages ?? 1); page += 1) {
        const params = new URLSearchParams({
          app_id: this.options.appId,
          app_key: this.options.appKey,
          results_per_page: String(this.options.resultsPerPage ?? 50),
          what: query,
          where: location,
          "content-type": "application/json"
        });
        const response = await fetch(`https://api.adzuna.com/v1/api/jobs/${encodeURIComponent(this.options.countryCode)}/search/${page}?${params}` , { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`Adzuna request failed: HTTP ${response.status}`);
        const body = (await response.json()) as AdzunaResponse;
        for (const item of body.results ?? []) {
          const title = string(item.title); const url = string(item.redirect_url); if (!title || !url) continue;
          const company = item.company && typeof item.company === "object" ? string((item.company as Record<string, unknown>).display_name) : null;
          const loc = item.location && typeof item.location === "object" ? string((item.location as Record<string, unknown>).display_name) : null;
          jobs.push({
            source: "adzuna", sourceJobId: string(item.id) ?? url, url, title,
            companyName: company ?? "Unknown company", companyDomain: null,
            location: loc ?? location ?? null, country: this.options.countryCode,
            workplaceType: null, employmentType: string(item.contract_type),
            description: string(item.description) ?? "", postedAt: date(item.created), updatedAt: null,
            contentHash: `${url}|${title}|${string(item.description) ?? ""}`
          });
        }
      }
    }
    return jobs;
  }
}
function string(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : value == null ? null : String(value); }
function date(value: unknown): Date | null { if (!value) return null; const parsed = new Date(String(value)); return Number.isNaN(parsed.getTime()) ? null : parsed; }
