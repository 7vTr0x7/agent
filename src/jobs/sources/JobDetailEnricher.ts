import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Job } from "../domain/Job";

export interface JobDetailEnricherOptions {
  readonly timeoutMs?: number;
  readonly concurrency?: number;
  readonly maxRedirects?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_REDIRECTS = 3;

export class JobDetailEnricher {
  private readonly timeoutMs: number;
  private readonly concurrency: number;
  private readonly maxRedirects: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: JobDetailEnricherOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    this.maxRedirects = Math.max(0, options.maxRedirects ?? DEFAULT_MAX_REDIRECTS);
  }

  async enrichJobs(jobs: readonly Job[], signal?: AbortSignal, force = false): Promise<Job[]> {
    const output = [...jobs];
    let index = 0;
    const worker = async (): Promise<void> => {
      while (true) {
        const current = index++;
        if (current >= jobs.length) return;
        if (signal?.aborted) return;
        output[current] = await this.enrich(jobs[current] as Job, signal, force);
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, jobs.length) }, () => worker()));
    return output;
  }

  async enrich(job: Job, signal?: AbortSignal, force = false): Promise<Job> {
    if ((!force && !shouldEnrich(job.description, job.title, job.source)) || signal?.aborted) return job;
    try {
      const html = await this.fetchDetailPage(job.url, signal);
      let description = extractJobPostingDescription(html);
      if (
        (!description || !containsExplicitExperience(description)) &&
        /:json$/i.test(job.source) &&
        /\b(?:senior|sr\.?|sitecore|dotnet|\.net)\b/i.test(job.title)
      ) {
        try {
          const validatedUrl = await validatePublicHttpUrl(job.url);
          const readerText = await fetchViaJinaReader(validatedUrl, signal);
          const readerDescription = extractJobPostingDescription(readerText);
          if (readerDescription && containsExplicitExperience(readerDescription)) description = readerDescription;
        } catch {
          // Keep the direct source content when the bounded fallback is unavailable.
        }
      }
      return description ? { ...job, description } : job;
    } catch {
      return job;
    }
  }

  private async fetchDetailPage(url: string, signal?: AbortSignal): Promise<string> {
    let currentUrl = await validatePublicHttpUrl(url);
    for (let redirects = 0; redirects <= this.maxRedirects; redirects += 1) {
      if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener("abort", onAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchWithConcurrency(currentUrl, controller.signal);
        if (response.status >= 300 && response.status < 400) {
          if (redirects === this.maxRedirects) throw new Error("Too many redirects");
          const location = response.headers.get("location");
          if (!location) throw new Error("Redirect response has no location");
          currentUrl = await validatePublicHttpUrl(new URL(location, currentUrl).toString());
          continue;
        }
        if (!response.ok) {
          if ((response.status === 403 || response.status === 429 || response.status >= 500) && redirects === 0) {
            return await fetchViaJinaReader(currentUrl, controller.signal);
          }
          throw new Error(`Detail page request failed: ${response.status}`);
        }
        return await response.text();
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      }
    }
    throw new Error("Detail page redirect limit exceeded");
  }

  private async fetchWithConcurrency(url: string, signal: AbortSignal): Promise<Response> {
    await this.acquire();
    try {
      return await fetch(url, {
        redirect: "manual",
        signal,
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent": "Mozilla/5.0 (compatible; JobAgent/0.1; +https://github.com/7vTr0x7/agent)"
        }
      });
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.waiters.shift()?.();
  }
}

export function shouldEnrich(description: string, title = "", source = ""): boolean {
  const normalized = description.trim();
  if (normalized.length === 0 || /\.\.\.$/.test(normalized)) return true;
  // Public JSON feeds can expose a complete-looking summary while omitting the
  // explicit experience requirement that exists on the canonical job page.
  // Only trigger the existing bounded detail fetch for target-like roles when
  // no explicit numeric experience signal is present in the feed content.
  const targetTitle = /\b(frontend|front-end|front end|react|next(?:\.js|js)?|full[- ]?stack|web developer|web engineer|software engineer)\b/i.test(title);
  if (/:json$/i.test(source)) return targetTitle;
  const hasNumericExperience = /\b\d+(?:\.\d+)?\s*(?:\+|\-|–|—|to)?\s*years?\b/i.test(normalized);
  return targetTitle && !hasNumericExperience;
}

export async function validatePublicHttpUrl(rawUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid detail page URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Unsupported detail page protocol");
  if (parsed.username || parsed.password) throw new Error("Detail page credentials are not allowed");

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "local") {
    throw new Error("Local detail page host is not allowed");
  }
  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error("Non-public detail page address is not allowed");
    return parsed.toString();
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Detail page hostname could not be resolved");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIp(address))) {
    throw new Error("Detail page hostname resolves to a non-public address");
  }
  return parsed.toString();
}

function isPublicIp(address: string): boolean {
  if (isIP(address) === 4) return isPublicIpv4(address);
  if (isIP(address) === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [a, b] = octets as [number, number, number, number];
  return !(
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) || (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) || (a === 203 && b === 0) || a >= 224
  );
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("ff")) return false;
  const words = expandIpv6(normalized);
  if (!words) return false;
  const first = words[0] as number;
  const second = words[1] as number;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return false;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const sixth = words[6] ?? 0;
    const seventh = words[7] ?? 0;
    const ipv4 = `${sixth >> 8}.${sixth & 255}.${seventh >> 8}.${seventh & 255}`;
    return isPublicIpv4(ipv4);
  }
  if (first === 0x2001 && second === 0x0db8) return false;
  return true;
}

function expandIpv6(address: string): number[] | null {
  const parts = address.split("::");
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 1 && parts.length === 2) return null;
  const expanded = parts.length === 2 ? [...left, ...new Array(missing).fill("0"), ...right] : left;
  if (expanded.length !== 8 || expanded.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return expanded.map((part) => parseInt(part, 16));
}

async function fetchViaJinaReader(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    signal,
    headers: {
      accept: "text/plain,text/html;q=0.9,*/*;q=0.8",
      "user-agent": "Mozilla/5.0 (compatible; JobAgent/0.1; +https://github.com/7vTr0x7/agent)"
    }
  });
  if (!response.ok) throw new Error(`Detail page reader request failed: ${response.status}`);
  return await response.text();
}

function containsExplicitExperience(value: string): boolean {
  return /(?:minimum|at least|required|must have)\s+(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*\+?\s*years?\b|\b\d+(?:\.\d+)?\s*\+\s*years?\b|\b\d+(?:\.\d+)?\s*years?\s+(?:minimum|required)\b/i.test(value);
}

function extractJobPostingDescription(html: string): string | null {
  let bestDescription: string | null = null;
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    const json = match[1];
    if (json === undefined) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(decodeHtml(json)); } catch { continue; }
    for (const item of flattenJsonLd(parsed)) {
      if (!isJobPosting(item)) continue;
      const description = clean(item.description);
      if (!description) continue;
      bestDescription ??= description;
      if (/\b\d+(?:\.\d+)?\s*(?:\+|years?|yrs?)/i.test(description)) return description;
    }
  }
  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch?.[1]) {
    const mainText = clean(mainMatch[1]);
    if (mainText && /\b\d+(?:\.\d+)?\s*(?:\+|years?|yrs?)/i.test(mainText)) return mainText.slice(0, 60_000);
  }
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch?.[1]) {
    const bodyText = clean(bodyMatch[1]);
    if (bodyText && /\b\d+(?:\.\d+)?\s*(?:\+|years?|yrs?)/i.test(bodyText)) return bodyText.slice(0, 60_000);
  }
  const plainText = clean(html);
  if (plainText && containsExplicitExperience(plainText)) return plainText.slice(0, 60_000);
  return bestDescription;
}

interface JobPostingJsonLd { "@type"?: string | string[]; description?: string; }
function flattenJsonLd(value: unknown): JobPostingJsonLd[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const graph = object["@graph"];
  return graph ? [object as JobPostingJsonLd, ...flattenJsonLd(graph)] : [object as JobPostingJsonLd];
}
function isJobPosting(item: JobPostingJsonLd): boolean {
  const type = item["@type"];
  return Array.isArray(type) ? type.some((entry) => entry.toLowerCase() === "jobposting") : type?.toLowerCase() === "jobposting";
}
function clean(value: string | undefined): string | null {
  if (!value) return null;
  const stripped = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return stripped || null;
}
function decodeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#34;/g, '"').replace(/&amp;/g, "&").replace(/&#38;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
