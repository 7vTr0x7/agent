export interface SearchResultExtractionDiagnostics {
  markdownCandidates: number;
  hrefCandidates: number;
  rssCandidates: number;
  bareUrlCandidates: number;
  redirectCandidates: number;
  validCandidates: number;
  normalizedUrls: number;
  duplicates: number;
  rejectedCandidates: number;
  rejectionReasons: Record<string, number>;
}

export interface SearchResultExtractionResult {
  readonly urls: string[];
  readonly diagnostics: SearchResultExtractionDiagnostics;
}

const MAX_DECODE_PASSES = 3;
const TRACKING_PARAMS = /^(utm_[a-z0-9_]+|gclid|dclid|fbclid|msclkid|mc_cid|mc_eid)$/i;
const URL_RE = /https?:\/\/[^\s<>'"`\]\[(){}]+/gi;
const LOGIN_SEGMENT_RE = /(^|\/)(login|signin|sign-in|signup|sign-up|register|registration|account)(\/|$)/i;
const WRAPPER_PARAM_NAMES = ["url", "target", "dest", "destination", "redirect", "redirect_url", "redirect_uri", "uddg"] as const;
const SEARCH_ENGINE_HOSTS = [
  "google.com",
  "google.co.in",
  "google.co.uk",
  "bing.com",
  "bing.co.uk",
  "duckduckgo.com",
  "search.brave.com",
  "jina.ai"
] as const;

export function extractSearchResultUrls(page: string, baseUrl?: string): SearchResultExtractionResult {
  const metrics = createDiagnostics();
  const canonical = new Set<string>();
  const candidates: Array<{ value: string; kind: "markdown" | "href" | "rss" | "bare" }> = [];

  for (const match of page.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/gi)) candidates.push({ value: match[1] ?? "", kind: "markdown" });
  for (const match of page.matchAll(/<link\b[^>]*>([\s\S]*?)<\/link>/gi)) candidates.push({ value: match[1] ?? "", kind: "rss" });
  for (const match of page.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) candidates.push({ value: match[1] ?? "", kind: "rss" });
  for (const match of page.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) candidates.push({ value: match[1] ?? "", kind: "href" });

  const textWithoutMarkup = page.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ");
  for (const match of textWithoutMarkup.matchAll(URL_RE)) candidates.push({ value: match[0] ?? "", kind: "bare" });

  const seenRaw = new Set<string>();
  for (const candidate of candidates) {
    incrementCandidateMetric(metrics, candidate.kind);
    const rawKey = candidate.value.trim();
    if (!rawKey || seenRaw.has(`${candidate.kind}:${rawKey}`)) continue;
    seenRaw.add(`${candidate.kind}:${rawKey}`);

    const unwrapped = unwrapDestination(rawKey, baseUrl);
    if (unwrapped.redirect) metrics.redirectCandidates += 1;
    if (!unwrapped.value) { reject(metrics, unwrapped.reason ?? "invalid_url"); continue; }

    const normalized = normalizeCandidateUrl(unwrapped.value, baseUrl);
    if (!normalized) { reject(metrics, "rejected_candidate"); continue; }
    metrics.validCandidates += 1;
    if (canonical.has(normalized)) { metrics.duplicates += 1; continue; }
    canonical.add(normalized);
    metrics.normalizedUrls += 1;
  }

  return { urls: [...canonical], diagnostics: metrics };
}

function createDiagnostics(): SearchResultExtractionDiagnostics {
  return { markdownCandidates: 0, hrefCandidates: 0, rssCandidates: 0, bareUrlCandidates: 0, redirectCandidates: 0, validCandidates: 0, normalizedUrls: 0, duplicates: 0, rejectedCandidates: 0, rejectionReasons: {} };
}
function incrementCandidateMetric(metrics: SearchResultExtractionDiagnostics, kind: "markdown" | "href" | "rss" | "bare"): void {
  if (kind === "markdown") metrics.markdownCandidates += 1;
  else if (kind === "href") metrics.hrefCandidates += 1;
  else if (kind === "rss") metrics.rssCandidates += 1;
  else metrics.bareUrlCandidates += 1;
}
function reject(metrics: SearchResultExtractionDiagnostics, reason: string): void { metrics.rejectedCandidates += 1; metrics.rejectionReasons[reason] = (metrics.rejectionReasons[reason] ?? 0) + 1; }

function unwrapDestination(value: string, baseUrl?: string): { value: string; redirect: boolean; reason?: string } {
  const decoded = boundedDecode(value);
  if (/^(javascript|data|blob|file):/i.test(decoded.trim())) return { value: "", redirect: false, reason: "unsupported_protocol" };
  const resolved = resolveAgainstBase(decoded, baseUrl);
  if (!resolved) return { value: "", redirect: false, reason: "malformed_url" };
  let url: URL;
  try { url = new URL(resolved); } catch { return { value: "", redirect: false, reason: "malformed_url" }; }
  const host = hostnameWithoutWww(url.hostname);

  if (isGoogleHost(host) && url.pathname === "/url") {
    const destination = firstParam(url, ["q", "url", "u", ...WRAPPER_PARAM_NAMES]);
    return destination ? { value: boundedDecode(destination), redirect: true } : { value: "", redirect: true, reason: "wrapper_without_destination" };
  }
  if (isBingHost(host) && (url.pathname === "/ck/a" || url.pathname === "/aclick" || url.searchParams.has("url") || url.searchParams.has("u"))) {
    const destination = firstParam(url, ["url", "target", "dest", "destination", "u", "r"]);
    if (destination) {
      const decodedDestination = decodeBingDestination(destination);
      return decodedDestination ? { value: decodedDestination, redirect: true } : { value: "", redirect: true, reason: "wrapper_without_destination" };
    }
    return { value: "", redirect: true, reason: "wrapper_without_destination" };
  }
  if (isDuckHost(host) && (url.pathname === "/l/" || url.searchParams.has("uddg"))) {
    const destination = firstParam(url, ["uddg", ...WRAPPER_PARAM_NAMES]);
    return destination ? { value: boundedDecode(destination), redirect: true } : { value: "", redirect: true, reason: "wrapper_without_destination" };
  }
  if (isJinaHost(host)) {
    const proxyDestination = decodeJinaDestination(url);
    return proxyDestination ? { value: proxyDestination, redirect: true } : { value: "", redirect: true, reason: "wrapper_without_destination" };
  }
  const genericDestination = firstParam(url, WRAPPER_PARAM_NAMES);
  if (genericDestination && isLikelyTrackingWrapper(url)) return { value: boundedDecode(genericDestination), redirect: true };
  return { value: decoded, redirect: false };
}

function normalizeCandidateUrl(value: string, baseUrl?: string): string {
  const decoded = boundedDecode(decodeHtmlEntities(value).trim());
  const resolved = resolveAgainstBase(decoded, baseUrl);
  if (!resolved) return "";
  let url: URL;
  try { url = new URL(resolved); } catch { return ""; }
  if (!/^https?:$/i.test(url.protocol)) return "";
  const host = hostnameWithoutWww(url.hostname);
  if (isSearchEngineHost(host) || isLocalHost(host) || LOGIN_SEGMENT_RE.test(url.pathname)) return "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  return url.toString();
}

function resolveAgainstBase(value: string, baseUrl?: string): string {
  const candidate = decodeHtmlEntities(value.trim());
  try {
    if (/^https?:\/\//i.test(candidate)) return candidate;
    if (/^\/\//.test(candidate)) return `https:${candidate}`;
    if (!baseUrl) return "";
    return new URL(candidate, baseUrl).toString();
  } catch { return ""; }
}
function firstParam(url: URL, names: readonly string[]): string | null { for (const name of names) { const value = url.searchParams.get(name); if (value) return value; } return null; }
function decodeBingDestination(value: string): string {
  const decoded = boundedDecode(value);
  if (/^https?:\/\//i.test(decoded)) return decoded;
  if (/^a1/i.test(decoded)) {
    try { const base64 = decoded.slice(2).replace(/-/g, "+").replace(/_/g, "/"); return boundedDecode(Buffer.from(base64, "base64").toString("utf8")); } catch { return ""; }
  }
  try { const base64 = decoded.replace(/-/g, "+").replace(/_/g, "/"); const maybeUrl = Buffer.from(base64, "base64").toString("utf8"); return /^https?:\/\//i.test(maybeUrl) ? maybeUrl : ""; } catch { return ""; }
}
function decodeJinaDestination(url: URL): string { const path = url.pathname.replace(/^\/+/, ""); return /^https?:\/\//i.test(path) ? boundedDecode(path) : ""; }
function isLikelyTrackingWrapper(url: URL): boolean { const path = url.pathname.toLowerCase(); return path.includes("redirect") || path.includes("out") || path.includes("click") || path.includes("track") || path === "/url" || path === "/l/"; }
function boundedDecode(value: string): string {
  let current = decodeHtmlEntities(value).trim();
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let next = current;
    try { next = decodeURIComponent(next); } catch {}
    next = decodeHtmlEntities(next).trim();
    if (next === current) break;
    current = next;
  }
  return current;
}
function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1").replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/&#(\d+);?/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10))).replace(/&([a-z][a-z0-9]+);/gi, (full: string, name: string) => named[name.toLowerCase()] ?? full);
}
function hostnameWithoutWww(hostname: string): string { return hostname.toLowerCase().replace(/^www\./, ""); }
function isSearchEngineHost(host: string): boolean { return SEARCH_ENGINE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`)); }
function isGoogleHost(host: string): boolean { return host === "google.com" || host.endsWith(".google.com") || host === "google.co.in" || host.endsWith(".google.co.in") || host === "google.co.uk" || host.endsWith(".google.co.uk"); }
function isBingHost(host: string): boolean { return host === "bing.com" || host.endsWith(".bing.com"); }
function isDuckHost(host: string): boolean { return host === "duckduckgo.com" || host.endsWith(".duckduckgo.com"); }
function isJinaHost(host: string): boolean { return host === "jina.ai" || host.endsWith(".jina.ai"); }
function isLocalHost(host: string): boolean { return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host.endsWith(".localhost"); }
