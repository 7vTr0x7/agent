import { Job } from "../domain/Job";
import { JobSource } from "./JobSource";

interface TechmapRecord { id?: string | number; title?: string; description?: string; fullDescription?: string; company?: string | { name?: string }; location?: string | { name?: string; city?: string; country?: string }; country?: string; city?: string; url?: string; link?: string; dateCreated?: string; dateUpdated?: string; employmentType?: string; workPlace?: string; source?: string; portal?: string; job?: TechmapRecord; }
interface TechmapResponse { result?: TechmapRecord[]; results?: TechmapRecord[]; jobs?: TechmapRecord[]; data?: TechmapRecord[]; }
export interface TechmapJobSourceOptions { apiUrl: string; apiKey: string; portals?: readonly string[]; countryCode?: string; city?: string; workPlace?: string; title?: string; skills?: string; dateCreated?: string; page?: number; limit?: number; }

export class TechmapJobSource implements JobSource {
  readonly name = "techmap";
  constructor(private readonly options: TechmapJobSourceOptions) {}
  async fetchJobs(): Promise<Job[]> {
    const jobs: Job[] = [];
    const portals = this.options.portals?.length ? this.options.portals : [undefined];
    for (const portal of portals) {
      const params = new URLSearchParams();
      if (portal) params.set("portal", portal);
      params.set("page", String(this.options.page ?? 1));
      if (this.options.countryCode) params.set("countryCode", this.options.countryCode);
      if (this.options.city) params.set("city", this.options.city);
      if (this.options.workPlace) params.set("workPlace", this.options.workPlace);
      if (this.options.title) params.set("title", this.options.title);
      if (this.options.skills) params.set("skills", this.options.skills);
      if (this.options.dateCreated) params.set("dateCreated", this.options.dateCreated);
      if (this.options.limit) params.set("pageSize", String(this.options.limit));
      const response = await fetch(`${this.options.apiUrl.replace(/\/$/, "")}?${params.toString()}`, { headers: { Accept: "application/json", "X-RapidAPI-Key": this.options.apiKey, "X-RapidAPI-Host": "daily-international-job-postings.p.rapidapi.com" } });
      if (!response.ok) throw new Error(`Techmap${portal ? ` ${portal}` : " global"} request failed: HTTP ${response.status}`);
      const body = (await response.json()) as TechmapResponse;
      for (const raw of body.result ?? body.results ?? body.jobs ?? body.data ?? []) { const normalized = normalize(raw.job ?? raw, portal ?? "global"); if (normalized) jobs.push(normalized); }
    }
    return jobs;
  }
}

function normalize(record: TechmapRecord, fallbackPortal: string): Job | null {
  const title = text(record.title); const url = text(record.url) ?? text(record.link); if (!title || !url) return null;
  const company = typeof record.company === "object" ? record.company?.name : record.company;
  const location = typeof record.location === "object" ? record.location?.name ?? [record.location?.city, record.location?.country].filter(Boolean).join(", ") : record.location;
  const description = text(record.fullDescription) ?? text(record.description) ?? "";
  const workplace = text(record.workPlace)?.toLowerCase() ?? "";
  const workplaceType = workplace.includes("remote") ? "remote" : workplace.includes("hybrid") ? "hybrid" : workplace ? "onsite" : null;
  return { source: `techmap:${record.portal ?? fallbackPortal}`, sourceJobId: String(record.id ?? `${url}:${title}`), url, title, companyName: text(company) ?? "Unknown company", companyDomain: null, location: text(location), country: text(record.country) ?? (typeof record.location === "object" ? text(record.location?.country) : null), workplaceType, employmentType: text(record.employmentType), description, postedAt: date(record.dateCreated), updatedAt: date(record.dateUpdated), contentHash: `${url}|${title}|${description.slice(0, 500)}` };
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : value == null ? null : String(value).trim() || null; }
function date(value: unknown): Date | null { if (!value) return null; const parsed = new Date(String(value)); return Number.isNaN(parsed.getTime()) ? null : parsed; }
