import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";

interface TechmapRecord {
  id?: string | number;
  title?: string;
  description?: string;
  fullDescription?: string;
  company?: string | { name?: string };
  location?: string | { name?: string; city?: string; country?: string };
  country?: string;
  city?: string;
  url?: string;
  link?: string;
  dateCreated?: string;
  dateUpdated?: string;
  employmentType?: string;
  workPlace?: string;
  source?: string;
  portal?: string;
}

interface TechmapResponse {
  result?: TechmapRecord[];
  results?: TechmapRecord[];
  jobs?: TechmapRecord[];
  data?: TechmapRecord[];
}

export interface TechmapJobSourceOptions {
  apiUrl: string;
  apiKey: string;
  portals: readonly string[];
  countryCode?: string;
  city?: string;
  workPlace?: string;
  query?: string;
  page?: number;
  limit?: number;
}

/**
 * Techmap exposes a normalized JSON job feed sourced from job boards,
 * ATS career pages and aggregators. One adapter therefore covers many
 * portals without pretending each portal has its own public API.
 */
export class TechmapJobSource implements JobSource {
  readonly name = "techmap";

  constructor(private readonly options: TechmapJobSourceOptions) {}

  async fetchJobs(): Promise<Job[]> {
    const jobs: Job[] = [];
    for (const portal of this.options.portals) {
      const params = new URLSearchParams();
      params.set("portal", portal);
      params.set("page", String(this.options.page ?? 1));
      if (this.options.countryCode) params.set("countryCode", this.options.countryCode);
      if (this.options.city) params.set("city", this.options.city);
      if (this.options.workPlace) params.set("workPlace", this.options.workPlace);
      if (this.options.query) params.set("query", this.options.query);
      const limit = this.options.limit;
      if (limit) params.set("limit", String(limit));

      const response = await fetch(`${this.options.apiUrl}?${params.toString()}`, {
        headers: { Accept: "application/json", "X-RapidAPI-Key": this.options.apiKey }
      });
      if (!response.ok) throw new Error(`Techmap ${portal} request failed: HTTP ${response.status}`);

      const body = (await response.json()) as TechmapResponse;
      const records = body.result ?? body.results ?? body.jobs ?? body.data ?? [];
      for (const record of records) {
        const normalized = normalize(record, portal);
        if (normalized) jobs.push(normalized);
      }
    }
    return jobs;
  }
}

function normalize(record: TechmapRecord, fallbackPortal: string): Job | null {
  const title = text(record.title);
  const url = text(record.url) ?? text(record.link);
  if (!title || !url) return null;

  const company = typeof record.company === "object" ? record.company?.name : record.company;
  const location = typeof record.location === "object"
    ? record.location?.name ?? [record.location?.city, record.location?.country].filter(Boolean).join(", ")
    : record.location;
  const description = text(record.fullDescription) ?? text(record.description) ?? "";
  const workplace = text(record.workPlace)?.toLowerCase() ?? "";
  const workplaceType = workplace.includes("remote") ? "remote" : workplace.includes("hybrid") ? "hybrid" : workplace ? "onsite" : null;

  return {
    source: `techmap:${record.portal ?? fallbackPortal}`,
    sourceJobId: String(record.id ?? `${url}:${title}`),
    url,
    title,
    companyName: text(company) ?? "Unknown company",
    companyDomain: null,
    location: text(location),
    country: text(record.country) ?? (typeof record.location === "object" ? text(record.location?.country) : null),
    workplaceType,
    employmentType: text(record.employmentType),
    description,
    postedAt: date(record.dateCreated),
    updatedAt: date(record.dateUpdated),
    contentHash: `${url}|${title}|${description.slice(0, 500)}`
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : value == null ? null : String(value).trim() || null;
}

function date(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
