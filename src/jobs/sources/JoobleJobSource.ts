import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";

export interface JoobleJobSourceOptions {
  apiKey: string;
  apiBaseUrl: string;
  keywords: string;
  location: string;
  page?: number;
  resultOnPage?: number;
}

interface JoobleResponse { jobs?: Array<Record<string, unknown>>; }

export class JoobleJobSource implements JobSource {
  readonly name = "jooble";
  constructor(private readonly options: JoobleJobSourceOptions) {}

  async fetchJobs(): Promise<Job[]> {
    const response = await fetch(`${this.options.apiBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(this.options.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        keywords: this.options.keywords,
        location: this.options.location,
        page: this.options.page ?? 1,
        ResultOnPage: this.options.resultOnPage ?? 100
      })
    });
    if (!response.ok) throw new Error(`Jooble request failed: HTTP ${response.status}`);
    const body = (await response.json()) as JoobleResponse;
    return (body.jobs ?? []).flatMap((item) => {
      const title = text(item.title); const url = text(item.link); if (!title || !url) return [];
      return [{
        source: "jooble", sourceJobId: text(item.id) ?? url, url, title,
        companyName: text(item.company) ?? "Unknown company", companyDomain: null,
        location: text(item.location) ?? this.options.location, country: null,
        workplaceType: null, employmentType: text(item.type),
        description: text(item.snippet) ?? "", postedAt: date(item.updated), updatedAt: date(item.updated),
        contentHash: `${url}|${title}|${text(item.snippet) ?? ""}`
      } satisfies Job];
    });
  }
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : value == null ? null : String(value).trim() || null; }
function date(value: unknown): Date | null { if (!value) return null; const parsed = new Date(String(value)); return Number.isNaN(parsed.getTime()) ? null : parsed; }
