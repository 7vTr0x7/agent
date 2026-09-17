import { promises as dns } from "node:dns";
import { isIP } from "node:net";

export type PublicEvidenceFailureReason =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "SSRF_BLOCKED"
  | "DNS_FAILURE"
  | "HTTP_403"
  | "HTTP_404"
  | "HTTP_429"
  | "HTTP_5XX"
  | "HTTP_OTHER"
  | "TIMEOUT"
  | "CONTENT_TYPE_REJECTED"
  | "RESPONSE_TOO_LARGE"
  | "EMPTY_RESPONSE"
  | "ANTI_BOT"
  | "CONNECTION_FAILURE"
  | "TLS_FAILURE"
  | "UNKNOWN_FAILURE";

export interface PublicEvidenceFetchResult {
  text: string | null;
  status?: number;
  finalUrl?: string;
  reason?: PublicEvidenceFailureReason;
}

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 4;
const JINA_READER_HOST = "r.jina.ai";

export async function fetchPublicEvidenceFallback(
  targetUrl: string,
  signal?: AbortSignal,
): Promise<PublicEvidenceFetchResult> {
  const checked = await validatePublicUrl(targetUrl);
  if ("reason" in checked) return { text: null, reason: checked.reason };

  const proxyUrl = `https://${JINA_READER_HOST}/${checked.url.toString()}`;
  const proxyChecked = await validatePublicUrl(proxyUrl);
  if ("reason" in proxyChecked) return { text: null, reason: proxyChecked.reason };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(proxyChecked.url, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        accept: "text/plain,text/html;q=0.9,application/xhtml+xml;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; job-agent-proactive-recruiter-evidence/1.0)",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { text: null, status: response.status, reason: "HTTP_OTHER" };
      const next = await validatePublicUrl(new URL(location, proxyChecked.url).toString());
      if ("reason" in next) return { text: null, status: response.status, reason: next.reason };
      return fetchProxyChain(next.url.toString(), signal, 1);
    }
    return consumeResponse(response);
  } catch (error) {
    return { text: null, reason: classifyError(error) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function fetchProxyChain(url: string, signal: AbortSignal | undefined, redirects: number): Promise<PublicEvidenceFetchResult> {
  if (redirects > MAX_REDIRECTS) return { text: null, reason: "HTTP_OTHER" };
  const checked = await validatePublicUrl(url);
  if ("reason" in checked) return { text: null, reason: checked.reason };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(checked.url, { signal: controller.signal, redirect: "manual", headers: { accept: "text/plain,text/html;q=0.9", "user-agent": "Mozilla/5.0 (compatible; job-agent-proactive-recruiter-evidence/1.0)" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { text: null, status: response.status, reason: "HTTP_OTHER" };
      return fetchProxyChain(new URL(location, checked.url).toString(), signal, redirects + 1);
    }
    return consumeResponse(response);
  } catch (error) {
    return { text: null, reason: classifyError(error) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function consumeResponse(response: Response): Promise<PublicEvidenceFetchResult> {
  if (response.status === 403) return { text: null, status: 403, reason: "HTTP_403" };
  if (response.status === 404) return { text: null, status: 404, reason: "HTTP_404" };
  if (response.status === 429) return { text: null, status: 429, reason: "HTTP_429" };
  if (response.status >= 500) return { text: null, status: response.status, reason: "HTTP_5XX" };
  if (!response.ok) return { text: null, status: response.status, reason: "HTTP_OTHER" };
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (contentType && !["text/plain", "text/html", "application/xhtml+xml"].includes(contentType)) return { text: null, status: response.status, reason: "CONTENT_TYPE_REJECTED" };
  const length = response.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES) return { text: null, status: response.status, reason: "RESPONSE_TOO_LARGE" };
  const text = await response.text();
  if (!text.trim()) return { text: null, status: response.status, reason: "EMPTY_RESPONSE" };
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return { text: null, status: response.status, reason: "RESPONSE_TOO_LARGE" };
  const normalized = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (/verify you are human|captcha|checking your browser|access denied|request blocked|unusual traffic|robot check|enable javascript|just a moment/i.test(normalized)) return { text: null, status: response.status, reason: "ANTI_BOT" };
  return { text, status: response.status, finalUrl: response.url || undefined };
}

async function validatePublicUrl(value: string): Promise<{ url: URL } | { reason: PublicEvidenceFailureReason }> {
  let url: URL;
  try { url = new URL(value); } catch { return { reason: "INVALID_URL" }; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { reason: "UNSUPPORTED_PROTOCOL" };
  if (url.username || url.password) return { reason: "SSRF_BLOCKED" };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return { reason: "SSRF_BLOCKED" };
  if (isIP(host)) return isPublicIp(host) ? { url } : { reason: "SSRF_BLOCKED" };
  let addresses: string[];
  try { addresses = (await dns.lookup(host, { all: true, verbatim: true })).map(a => a.address); } catch { return { reason: "DNS_FAILURE" }; }
  if (!addresses.length || addresses.some(a => !isPublicIp(a))) return { reason: addresses.length ? "SSRF_BLOCKED" : "DNS_FAILURE" };
  return { url };
}

function isPublicIp(ip: string): boolean {
  const value = ip.toLowerCase();
  if (isIP(value) === 4) {
    const [a, b, c] = value.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  const h = value.replace(/^\[|\]$/g, "");
  if (h.startsWith("::ffff:")) return isPublicIp(h.slice(7));
  return !(h === "::" || h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb") || h.startsWith("ff") || h.startsWith("2001:db8:"));
}

function classifyError(error: unknown): PublicEvidenceFailureReason {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/dns|getaddrinfo|enotfound|eai_again|eai_fail/.test(message)) return "DNS_FAILURE";
  if (/tls|certificate|ssl|cert_/.test(message)) return "TLS_FAILURE";
  if (/timeout|timed out|abort/.test(message)) return "TIMEOUT";
  if (/connect|socket|econn|enetunreach|ehostunreach/.test(message)) return "CONNECTION_FAILURE";
  return "UNKNOWN_FAILURE";
}
