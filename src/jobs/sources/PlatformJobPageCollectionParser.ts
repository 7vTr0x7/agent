import { Job } from "../domain/Job";
import { parsePlatformJobPage } from "./PlatformJobPageParser";

export interface ParsedJobCollection {
  readonly jobs: readonly Job[];
  readonly detailUrls: readonly string[];
}

/** Generic multi-record parser. It delegates validation/normalization to the existing page parser. */
export function parsePlatformJobPageCollection(html: string, sourceUrl: string, platformName: string): ParsedJobCollection {
  const candidates = extractJobPostingJsonCandidates(html);
  const jobs = new Map<string, Job>();
  for (const candidate of candidates) {
    const parsed = parsePlatformJobPage(`<script type="application/ld+json">${escapeJsonScript(JSON.stringify(candidate))}</script>`, sourceUrl, platformName);
    if (parsed.job) jobs.set(parsed.job.url.toLowerCase(), parsed.job);
  }
  if (!jobs.size) {
    const parsed = parsePlatformJobPage(html, sourceUrl, platformName);
    if (parsed.job) jobs.set(parsed.job.url.toLowerCase(), parsed.job);
  }
  return { jobs: [...jobs.values()], detailUrls: [] };
}

function extractJobPostingJsonCandidates(html: string): unknown[] {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const candidates: unknown[] = [];
  for (const match of scripts) {
    for (const value of parseJson(match[1] ?? "")) collectJobPostings(value, candidates);
  }
  const embedded = [...html.matchAll(/<script[^>]+(?:id=["']__NEXT_DATA__["']|type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of embedded) {
    for (const value of parseJson(match[1] ?? "")) collectJobLikeObjects(value, candidates);
  }
  return candidates;
}

function collectJobPostings(value: unknown, output: unknown[], seen = new Set<unknown>()): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) { for (const item of value) collectJobPostings(item, output, seen); return; }
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
  if (types.some((entry) => entry.toLowerCase().replace(/[\s_-]/g, "") === "jobposting")) output.push(record);
  for (const child of Object.values(record)) collectJobPostings(child, output, seen);
}

function collectJobLikeObjects(value: unknown, output: unknown[], seen = new Set<unknown>()): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) { for (const item of value) collectJobLikeObjects(item, output, seen); return; }
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const organization = record.hiringOrganization ?? record.employer ?? record.company ?? record.organization;
  const employer = typeof organization === "string" ? organization : organization && typeof organization === "object" && typeof (organization as Record<string, unknown>).name === "string" ? (organization as Record<string, unknown>).name : "";
  if (title && description && employer) output.push(record);
  for (const child of Object.values(record)) collectJobLikeObjects(child, output, seen);
}

function parseJson(raw: string): unknown[] {
  const cleaned = raw.trim().replace(/^<!--/, "").replace(/-->$/, "");
  try { return [JSON.parse(cleaned)]; } catch { return []; }
}
function escapeJsonScript(value: string): string { return value.replace(/<\//g, "<\\/"); }
