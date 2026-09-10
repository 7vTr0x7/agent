import { createHash } from "node:crypto";
import { Job } from "../domain/Job";

export type JobPageParseFailure =
  | "no-structured-data"
  | "missing-title"
  | "missing-description"
  | "missing-employer";

export interface JobPageDiagnostics {
  readonly url: string;
  readonly parsed: boolean;
  readonly parser: "json-ld" | "embedded-state" | "microdata" | "html-metadata" | "html-labels" | "none";
  readonly failure?: JobPageParseFailure;
}

export interface ParsedJobPage {
  readonly job: Job | null;
  readonly diagnostics: JobPageDiagnostics;
}

export function parsePlatformJobPage(html: string, sourceUrl: string, platformName: string): ParsedJobPage {
  const jsonLd = extractJobPostingFromJsonLd(html);
  if (jsonLd) return buildJob(jsonLd, sourceUrl, platformName, "json-ld");

  const embedded = extractEmbeddedJob(html);
  if (embedded) return buildJob(embedded, sourceUrl, platformName, "embedded-state");

  const microdata = extractMicrodataJob(html);
  if (microdata) return buildJob(microdata, sourceUrl, platformName, "microdata");

  const metadata = extractMetadataJob(html);
  if (metadata) return buildJob(metadata, sourceUrl, platformName, "html-metadata");

  const labeled = extractExplicitHtmlFields(html);
  if (labeled) return buildJob(labeled, sourceUrl, platformName, "html-labels");

  return { job: null, diagnostics: { url: sourceUrl, parsed: false, parser: "none", failure: "no-structured-data" } };
}

type RawPosting = Record<string, unknown>;

function buildJob(posting: RawPosting, sourceUrl: string, platformName: string, parser: JobPageDiagnostics["parser"]): ParsedJobPage {
  const title = cleanText(valueAt(posting, "title"));
  const description = cleanText(valueAt(posting, "description"));
  const employer = organizationName(posting);
  if (!title) return failure(sourceUrl, parser, "missing-title");
  if (!description) return failure(sourceUrl, parser, "missing-description");
  if (!employer) return failure(sourceUrl, parser, "missing-employer");

  const url = normalizeUrl(valueAt(posting, "url"), sourceUrl);
  const location = locationText(posting.jobLocation ?? posting.location) || cleanText(valueAt(posting, "jobLocationType")) || "Worldwide";
  const remote = /telecommute|remote|work from anywhere|distributed/i.test(`${valueAt(posting, "jobLocationType")} ${location}`);
  const hybrid = /hybrid/i.test(location);
  const sourceJobId = `${platformName}:${url}`;
  const contentHash = createHash("sha256").update([platformName, sourceJobId, title, url, description].join("|"), "utf8").digest("hex");

  return {
    job: {
      source: `platform-search:${platformName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      sourceJobId,
      url,
      title,
      companyName: employer.name,
      companyDomain: employer.domain,
      location,
      country: inferCountry(location),
      workplaceType: remote ? "remote" : hybrid ? "hybrid" : "onsite",
      employmentType: cleanText(valueAt(posting, "employmentType")) || null,
      description,
      postedAt: parseDate(valueAt(posting, "datePosted")),
      updatedAt: parseDate(valueAt(posting, "dateModified")),
      contentHash
    },
    diagnostics: { url: sourceUrl, parsed: true, parser }
  };
}

function failure(url: string, parser: JobPageDiagnostics["parser"], failureReason: JobPageParseFailure): ParsedJobPage {
  return { job: null, diagnostics: { url, parsed: false, parser, failure: failureReason } };
}

function extractJobPostingFromJsonLd(html: string): RawPosting | null {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    const values = parseJsonCandidates(match[1] ?? "");
    for (const value of values) {
      const posting = findJobPosting(value);
      if (posting) return posting;
    }
  }
  return null;
}

function findJobPosting(value: unknown, seen = new Set<unknown>()): RawPosting | null {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item, seen);
      if (found) return found;
    }
    return null;
  }
  const record = value as RawPosting;
  const type = record["@type"];
  const types = Array.isArray(type) ? type.map(String) : [String(type ?? "")];
  if (types.some((v) => v.toLowerCase().replace(/[\s_-]/g, "") === "jobposting")) return record;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item", "data", "jobPosting"]) {
    const found = findJobPosting(record[key], seen);
    if (found) return found;
  }
  return null;
}

function parseJsonCandidates(raw: string): unknown[] {
  const cleaned = raw.trim().replace(/^<!--/, "").replace(/-->$/, "");
  try { return [JSON.parse(cleaned)]; } catch { return extractBalancedJsonValues(cleaned); }
}

function extractBalancedJsonValues(raw: string): unknown[] {
  const values: unknown[] = [];
  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== "{" && raw[start] !== "[") continue;
    const end = balancedJsonEnd(raw, start);
    if (end < 0) continue;
    try { values.push(JSON.parse(raw.slice(start, end + 1))); } catch { /* keep scanning */ }
  }
  return values;
}

function balancedJsonEnd(raw: string, start: number): number {
  const stack: string[] = [];
  let quote = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = false;
      continue;
    }
    if (char === '"') { quote = true; continue; }
    if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      const expected = char === "}" ? "{" : "[";
      if (stack.pop() !== expected) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

function extractEmbeddedJob(html: string): RawPosting | null {
  const patterns = [
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    for (const value of parseJsonCandidates(match[1] ?? "")) {
      const posting = findJobLikeObject(value);
      if (posting) return posting;
    }
  }
  return null;
}

function findJobLikeObject(value: unknown, seen = new Set<unknown>()): RawPosting | null {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) { const found = findJobLikeObject(item, seen); if (found) return found; }
    return null;
  }
  const record = value as RawPosting;
  const title = cleanText(valueAt(record, "title"));
  const description = cleanText(valueAt(record, "description"));
  const employer = organizationName(record);
  if (title && description && employer) return record;
  for (const child of Object.values(record)) {
    const found = findJobLikeObject(child, seen);
    if (found) return found;
  }
  return null;
}

/**
 * Some job pages publish Schema.org JobPosting as HTML Microdata rather than
 * JSON-LD. This is still explicit employer evidence and is safer than guessing
 * the employer from the platform hostname or page title.
 */
function extractMicrodataJob(html: string): RawPosting | null {
  if (!/<[^>]+itemtype=["'][^"']*JobPosting/i.test(html) && !/<[^>]+itemprop=["'](?:title|description|hiringOrganization|jobLocation)["']/i.test(html)) return null;

  const title = firstItemProp(html, "title");
  const description = firstItemProp(html, "description");
  const employer = firstItemProp(html, "name", /itemprop=["']hiringOrganization["']/i) || firstNestedOrganizationName(html);
  if (!title || !description || !employer) return null;

  const location = firstItemProp(html, "jobLocation");
  const employmentType = firstItemProp(html, "employmentType");
  const datePosted = firstItemProp(html, "datePosted");
  const dateModified = firstItemProp(html, "dateModified");
  return {
    title,
    description,
    hiringOrganization: { name: employer },
    location,
    employmentType,
    datePosted,
    dateModified
  };
}

function firstItemProp(html: string, property: string, context?: RegExp): string {
  const escaped = escapeRegex(property);
  const tagPattern = new RegExp(`<([a-z0-9]+)\\b[^>]*itemprop=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
  for (const match of html.matchAll(tagPattern)) {
    const outerStart = match.index ?? 0;
    const outer = match[0] ?? "";
    if (context && !context.test(outer) && property === "name") continue;
    const text = cleanText(match[2] ?? "");
    if (text) return text;
    const content = outer.match(/\bcontent=["']([^"']*)["']/i)?.[1];
    if (content) return cleanText(content);
    void outerStart;
  }

  const metaPattern = new RegExp(`<meta\\b[^>]*itemprop=["']${escaped}["'][^>]*>`, "i");
  const meta = html.match(metaPattern)?.[0] ?? "";
  return cleanText(meta.match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? "");
}

function firstNestedOrganizationName(html: string): string {
  const organization = html.match(/itemprop=["']hiringOrganization["'][^>]*>[\s\S]{0,12000}?itemprop=["']name["'][^>]*>([\s\S]*?)<\//i);
  return cleanText(organization?.[1] ?? "");
}

function extractMetadataJob(html: string): RawPosting | null {
  const title = firstMeta(html, ["og:title", "twitter:title"]) || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const description = firstMeta(html, ["og:description", "description", "twitter:description"]);
  const employer = firstMeta(html, ["job:company", "og:company", "article:author"]);
  if (!cleanText(title) || !cleanText(description) || !cleanText(employer)) return null;
  if (/^(twitter|facebook|linkedin|google|indeed|naukri|glassdoor)$/i.test(cleanText(employer))) return null;
  return { title, description, hiringOrganization: { name: cleanText(employer) } };
}

function extractExplicitHtmlFields(html: string): RawPosting | null {
  const title = firstLabeledValue(html, /(job\s*title|position|role)\s*[:\-]/i);
  const description = firstLabeledValue(html, /(job\s*description|description)\s*[:\-]/i);
  const employer = firstLabeledValue(html, /(employer|company|hiring\s*organization|organization)\s*[:\-]/i);
  if (!title || !description || !employer) return null;
  return { title, description, hiringOrganization: { name: employer } };
}

function firstLabeledValue(html: string, label: RegExp): string {
  const text = stripHtml(html);
  const match = text.match(new RegExp(label.source + "\\s*([^|•\\n]{2,180})", "i"));
  return cleanText(match?.[1] ?? "");
}

function firstMeta(html: string, names: string[]): string {
  for (const name of names) {
    const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${escapeRegex(name)}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
    const reverse = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${escapeRegex(name)}["'][^>]*>`, "i");
    const value = html.match(pattern)?.[1] ?? html.match(reverse)?.[1] ?? "";
    if (value) return decodeEntities(value);
  }
  return "";
}

function organizationName(posting: RawPosting): { name: string; domain: string | null } | null {
  const value = posting.hiringOrganization ?? posting.employer ?? posting.company ?? posting.organization;
  const record = Array.isArray(value) ? value.find((item) => item && typeof item === "object") : value;
  if (record && typeof record === "object") {
    const object = record as RawPosting;
    const name = cleanText(valueAt(object, "name"));
    if (!name) return null;
    return { name, domain: organizationDomain(object) };
  }
  const name = cleanText(typeof value === "string" ? value : "");
  return name ? { name, domain: null } : null;
}

function organizationDomain(record: RawPosting): string | null {
  for (const key of ["sameAs", "url", "website"]) {
    const values = Array.isArray(record[key]) ? record[key] : [record[key]];
    for (const value of values) {
      if (typeof value !== "string") continue;
      try { return new URL(value).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* not a URL */ }
    }
  }
  return null;
}

function locationText(value: unknown): string | null {
  const items = Array.isArray(value) ? value : [value];
  const parts: string[] = [];
  for (const item of items) {
    if (typeof item === "string") { parts.push(cleanText(item)); continue; }
    if (!item || typeof item !== "object") continue;
    const record = item as RawPosting;
    const address = record.address && typeof record.address === "object" ? record.address as RawPosting : record;
    const part = [valueAt(address, "addressLocality"), valueAt(address, "addressRegion"), valueAt(address, "addressCountry")].map(cleanText).filter(Boolean).join(", ");
    if (part) parts.push(part);
  }
  return parts.filter(Boolean).join("; ") || null;
}

function valueAt(record: RawPosting, key: string): string {
  const value = record[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function normalizeUrl(value: string, fallback: string): string {
  try { return new URL(value || fallback, fallback).toString(); } catch { return fallback; }
}

function cleanText(value: string): string { return stripHtml(decodeEntities(value)).replace(/\s+/g, " ").trim(); }
function stripHtml(value: string): string { return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " "); }
function decodeEntities(value: string): string { return value.replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'"); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function parseDate(value: unknown): Date | null { if (typeof value !== "string" && typeof value !== "number") return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function inferCountry(location: string | null): string | null { const s = (location ?? "").toLowerCase(); if (/india|bangalore|bengaluru|mumbai|pune|hyderabad|chennai|delhi|gurugram|noida/.test(s)) return "India"; if (/singapore/.test(s)) return "Singapore"; if (/japan|tokyo|osaka|kyoto/.test(s)) return "Japan"; if (/united states|\busa\b|u\.s\./.test(s)) return "United States"; return null; }
