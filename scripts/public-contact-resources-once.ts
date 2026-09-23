import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { Database } from "../src/database/Database";
import { ConfiguredCandidateProfileResolver } from "../src/candidates/ConfiguredCandidateProfileResolver";
import { sourceList } from "../src/recruiters/PublicSearchProviderRegistry";

type Resource = { url: string; sourceType: "HTML" | "TEXT" | "CSV" | "JSON" };
type ValidationStatus = "VALID" | "LIKELY" | "UNVERIFIED" | "INVALID";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CONTACT_RESOURCE_BLOCKED_HOSTS = new Set(["simplyhired.com", "joblist.com", "snagajob.com"]);
const SEARCH_HOSTS = new Set([
  "google.com", "www.google.com", "bing.com", "www.bing.com", "html.duckduckgo.com",
  "duckduckgo.com", "startpage.com", "www.startpage.com", "search.yahoo.com",
  "www.yahoo.com", "search.brave.com", "www.mojeek.com", "qwant.com", "www.qwant.com",
  "r.jina.ai"
]);
const GENERIC = /^(noreply|no-reply|postmaster|webmaster|admin|support|privacy|legal|press|media|marketing|sales)$/i;
const HIRING_INTENT = /we['’]?re\s+hiring|we\s+are\s+hiring|hiring\s+(?:for|a|an)|looking\s+for\s+(?:a|an)?\s*(?:frontend|front-end|react|next\.js|javascript|typescript|software|full[ -]?stack)|send\s+(?:your|me\s+your)\s+(?:resume|cv)|share\s+your\s+(?:resume|cv)|apply\s+(?:here|now)|referrals?\s+welcome|talent\s+acquisition|recruit(?:er|ing)|join\s+(?:our|my)\s+team/i;
const ROLE_OR_SKILL = /frontend|front-end|react(?:\.js|js)?|next(?:\.js|js)?|typescript|javascript|software\s+engineer|developer|engineering/i;
const RESOURCE_SIGNAL = /career|careers|job|jobs|hiring|hire|recruit|recruiting|talent|contact|about|people|team|resume|apply/i;

function clean(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function canonical(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

function host(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function typeFor(url: string, contentType: string): Resource["sourceType"] {
  const pathname = (() => {
    try { return new URL(url).pathname.toLowerCase(); } catch { return ""; }
  })();
  if (/\.csv(?:$|\?)/.test(pathname) || contentType.includes("csv")) return "CSV";
  if (/\.json(?:$|\?)/.test(pathname) || contentType.includes("json")) return "JSON";
  if (/\.txt(?:$|\?)/.test(pathname) || contentType.startsWith("text/plain")) return "TEXT";
  return "HTML";
}

function legitimate(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = host(url);
    const pathname = parsed.pathname.toLowerCase();
    const isSearchHost = SEARCH_HOSTS.has(hostname) || [...SEARCH_HOSTS].some((domain) => hostname.endsWith(`.${domain}`));
    const isBlockedResourceHost =
      CONTACT_RESOURCE_BLOCKED_HOSTS.has(hostname) ||
      [...CONTACT_RESOURCE_BLOCKED_HOSTS].some((domain) => hostname.endsWith(`.${domain}`));

    if (!/^https?:$/.test(parsed.protocol) || !hostname || isSearchHost || isBlockedResourceHost || hostname === "localhost" || hostname.endsWith(".local")) {
      return false;
    }
    if (/^\/(?:api|search|query|suggest|autocomplete|static|assets?|scripts?|css|js)(?:\/|$)/.test(pathname)) return false;
    if (/\.(?:js|css|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot)(?:$|[?#])/i.test(pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
    const [a, b] = parts as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) || (a === 100 && b >= 64 && b <= 127);
  }
  if (version === 6) {
    const compact = address.toLowerCase().split(":").join("").padStart(32, "0");
    return address === "::1" || address === "::" || compact.startsWith("fc") ||
      compact.startsWith("fd") || compact.startsWith("fe8") || compact.startsWith("fe9") ||
      compact.startsWith("fea") || compact.startsWith("feb") || compact.startsWith("ff") ||
      compact.startsWith("00000000000000000000ffff");
  }
  return true;
}

async function assertPublicFetchUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (!/^https?:$/.test(parsed.protocol) || !legitimate(url)) throw new Error("UNSAFE_FETCH_URL");
  const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("PRIVATE_OR_NON_PUBLIC_ADDRESS");
  }
}

type FetchResult =
  | { ok: true; text: string; contentType: string; finalUrl: string; httpStatus: number; bytesRead: number; elapsedMs: number }
  | { ok: false; failureReason: "HTTP_NON_2XX" | "TIMEOUT" | "NETWORK_ERROR" | "REDIRECT_ERROR" | "CONTENT_TOO_LARGE" | "EMPTY_BODY" | "UNSUPPORTED_CONTENT_TYPE" | "PARSER_ERROR" | "EMAIL_EXTRACTION_ERROR"; httpStatus?: number; contentType?: string; finalUrl?: string; bytesRead?: number; elapsedMs: number; errorCode?: string };

async function fetchText(url: string): Promise<FetchResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.PUBLIC_CONTACT_RESOURCE_TIMEOUT_MS ?? 12000));

  try {
    let currentUrl = url;
    for (let hop = 0; hop <= 3; hop += 1) {
      try {
        await assertPublicFetchUrl(currentUrl);
      } catch (error) {
        return { ok: false, failureReason: "REDIRECT_ERROR", finalUrl: currentUrl, elapsedMs: Date.now() - started, errorCode: error instanceof Error ? error.message : "UNSAFE_FETCH_URL" };
      }

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "text/html,text/plain,text/csv,application/json,*/*;q=0.5",
            "user-agent": "job-agent-public-contact-resource-discovery/1.0"
          }
        });
      } catch (error) {
        return {
          ok: false,
          failureReason: controller.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR",
          elapsedMs: Date.now() - started,
          errorCode: error instanceof Error && "code" in error ? String((error as Error & { code?: unknown }).code ?? "") : undefined
        };
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || hop === 3) {
          return { ok: false, failureReason: "REDIRECT_ERROR", httpStatus: response.status, finalUrl: currentUrl, elapsedMs: Date.now() - started, errorCode: location ? "REDIRECT_LIMIT" : "MISSING_LOCATION" };
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          return { ok: false, failureReason: "REDIRECT_ERROR", httpStatus: response.status, finalUrl: currentUrl, elapsedMs: Date.now() - started, errorCode: "INVALID_LOCATION" };
        }
        continue;
      }

      const finalUrl = response.url || currentUrl;
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!response.ok) return { ok: false, failureReason: "HTTP_NON_2XX", httpStatus: response.status, contentType, finalUrl, elapsedMs: Date.now() - started };

      const maxBytes = Number(process.env.PUBLIC_CONTACT_RESOURCE_MAX_BYTES ?? 8 * 1024 * 1024);
      if (response.body) {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > maxBytes) {
              await reader.cancel();
              return { ok: false, failureReason: "CONTENT_TOO_LARGE", httpStatus: response.status, contentType, finalUrl, bytesRead: total, elapsedMs: Date.now() - started };
            }
            chunks.push(part.value);
          }
        } catch (error) {
          return { ok: false, failureReason: "NETWORK_ERROR", httpStatus: response.status, contentType, finalUrl, bytesRead: total, elapsedMs: Date.now() - started, errorCode: error instanceof Error ? error.name : undefined };
        } finally {
          reader.releaseLock();
        }
        if (total === 0) return { ok: false, failureReason: "EMPTY_BODY", httpStatus: response.status, contentType, finalUrl, bytesRead: 0, elapsedMs: Date.now() - started };
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
        return { ok: true, text: new TextDecoder().decode(out), contentType, finalUrl, httpStatus: response.status, bytesRead: total, elapsedMs: Date.now() - started };
      }

      const text = await response.text();
      const bytesRead = new TextEncoder().encode(text).byteLength;
      if (bytesRead === 0) return { ok: false, failureReason: "EMPTY_BODY", httpStatus: response.status, contentType, finalUrl, bytesRead, elapsedMs: Date.now() - started };
      if (bytesRead > maxBytes) return { ok: false, failureReason: "CONTENT_TOO_LARGE", httpStatus: response.status, contentType, finalUrl, bytesRead, elapsedMs: Date.now() - started };
      return { ok: true, text, contentType, finalUrl, httpStatus: response.status, bytesRead, elapsedMs: Date.now() - started };
    }

    return { ok: false, failureReason: "REDIRECT_ERROR", finalUrl: currentUrl, elapsedMs: Date.now() - started, errorCode: "REDIRECT_LIMIT" };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) continue;
      out[index] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function unwrapSearchResultUrl(value: string): string {
  try {
    const parsed = new URL(value, "https://duckduckgo.com");
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "duckduckgo.com" && parsed.pathname.startsWith("/l/")) {
      const target = parsed.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }
    if (host === "google.com" && parsed.pathname === "/url") {
      const target = parsed.searchParams.get("q") ?? parsed.searchParams.get("url");
      if (target) return decodeURIComponent(target);
    }
  } catch {}
  return value;
}
export function urlsFromSearch(text: string): string[] {
  const decoded = text
    .replace(/&amp;/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&#x2f;|&#47;/gi, "/")
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/")
    .replace(/%3F/gi, "?")
    .replace(/%3D/gi, "=")
    .replace(/%26/gi, "&");
  const candidates = [
    ...(decoded.match(/https?:\/\/[^\s<>()\]]+/gi) ?? []),
    ...[...decoded.matchAll(/href\\s*=\\s*["']([^"']+)["']/gi)].map((match) => match[1] ?? "")
  ];
  return [...new Set(candidates
    .map((value) => value.replace(/[>"'.,;:!?]+$/g, ""))
    .map(unwrapSearchResultUrl)
    .map(canonical))]
    .filter(legitimate);
}

function resourceLooksRelevant(url: string): boolean {
  try {
    const parsed = new URL(url);
    const value = (parsed.hostname + " " + parsed.pathname).toLowerCase();
    return RESOURCE_SIGNAL.test(value);
  } catch {
    return false;
  }
}

export function extractEmails(text: string): string[] {
  return [...new Set((text.match(EMAIL) ?? []).map((value) => value.toLowerCase()))]
    .filter((email) => !GENERIC.test(email.split("@")[0] ?? "") && !/^(example|test)@/i.test(email));
}

function extractEmailContexts(text: string): Array<{ email: string; context: string }> {
  const matches = [...text.matchAll(EMAIL)];
  const output = new Map<string, string>();
  for (const match of matches) {
    const email = String(match[0]).toLowerCase();
    const index = match.index ?? 0;
    if (GENERIC.test(email.split("@")[0] ?? "") || /^(example|test)@/i.test(email)) continue;
    const start = Math.max(0, index - 900);
    const end = Math.min(text.length, index + email.length + 900);
    output.set(email, text.slice(start, end));
  }
  return [...output.entries()].map(([email, context]) => ({ email, context }));
}

export function relevance(email: string, context: string, skills: string[]): number {
  const haystack = (email + " " + context).toLowerCase();
  let score = 0;
  if (HIRING_INTENT.test(haystack)) score += 40;
  if (ROLE_OR_SKILL.test(haystack)) score += 25;
  if (skills.some((skill) => haystack.includes(skill.toLowerCase()))) score += 20;
  if (!/support|privacy|legal|press|newsletter|unsubscribe/i.test(haystack)) score += 15;
  return Math.min(100, score);
}

async function validation(email: string): Promise<ValidationStatus> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "INVALID";
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "INVALID";
  try {
    return (await dns.resolveMx(domain)).length ? "LIKELY" : "INVALID";
  } catch {
    return "UNVERIFIED";
  }
}

async function main(): Promise<void> {
  const profile = await ConfiguredCandidateProfileResolver.fromEnvironment().getById(process.env.CANDIDATE_PROFILE_ID ?? "");
  if (!profile) throw new Error("Configured candidate profile could not be resolved.");

  const db = new Database(process.env.DATABASE_URL ?? "");
  const excludedSites = "-site:simplyhired.com -site:joblist.com -site:snagajob.com -site:indeed.com -site:linkedin.com -site:glassdoor.com -site:foundit.in";
  const queries = [
    `"frontend developer" "Bengaluru" careers email ${excludedSites}`,
    `"React developer" "Bangalore" careers email ${excludedSites}`,
    `"frontend developer" "India" hiring email ${excludedSites}`,
    `"React" "Bangalore" recruiting email ${excludedSites}`,
    `"send your resume" "frontend developer" Bengaluru ${excludedSites}`,
    `"send your resume" "React developer" India ${excludedSites}`,
    `"talent acquisition" React Bengaluru email ${excludedSites}`,
    `"hiring" "Next.js" Bengaluru email ${excludedSites}`,
    `site:github.com careers contact recruiter email ${excludedSites}`
  ];

  const configuredSeeds = (process.env.PUBLIC_CONTACT_RESOURCE_SEED_URLS ?? "")
    .split(/\s*,\s*/)
    .map((value) => value.trim())
    .filter(Boolean);

  const searchRequests = queries.flatMap((query) => sourceList(query).map((source) => ({ query, source })));
  const pages = (await mapLimit(searchRequests, 4, async ({ source }) => {
    const response = await fetchText(source.url);
    return response.ok ? [{ source: source.url, text: response.text }] : [];
  })).flat();

  const resources = new Map<string, Resource>();
  for (const page of pages) {
    for (const url of urlsFromSearch(page.text)) {
      if (resourceLooksRelevant(url)) {
        resources.set(url, {
          url,
          sourceType: /\.csv(?:$|\?)/i.test(url) ? "CSV" : /\.json(?:$|\?)/i.test(url) ? "JSON" : /\.txt(?:$|\?)/i.test(url) ? "TEXT" : "HTML"
        });
      }
    }
  }

  for (const seed of configuredSeeds) {
    if (legitimate(seed)) {
      resources.set(canonical(seed), {
        url: canonical(seed),
        sourceType: /\.csv(?:$|\?)/i.test(seed) ? "CSV" : /\.json(?:$|\?)/i.test(seed) ? "JSON" : /\.txt(?:$|\?)/i.test(seed) ? "TEXT" : "HTML"
      });
    }
  }

  const resourceList = [...resources.values()];
  const processed = await mapLimit(resourceList, 4, async (resource) => {
    const fetched = await fetchText(resource.url);
    if (!fetched.ok) {
      return {
        resource, emails: 0, qualified: 0, persisted: 0, duplicates: 0, invalid: 0,
        status: "FAILED" as const, type: resource.sourceType, failureReason: fetched.failureReason,
        httpStatus: fetched.httpStatus, contentType: fetched.contentType, finalUrl: fetched.finalUrl,
        bytesRead: fetched.bytesRead, elapsedMs: fetched.elapsedMs, errorCode: fetched.errorCode
      };
    }

    const type = typeFor(resource.url, fetched.contentType);
    const text = type === "HTML" ? clean(fetched.text) : fetched.text;
    const emailContexts = extractEmailContexts(text);
    const emails = emailContexts.map((item) => item.email);
    const qualified = emailContexts.filter((item) => relevance(item.email, `${resource.url} ${item.context}`, [...profile.skills]) >= 60);

    const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
      .replace(/\s+/g, " ").trim().slice(0, 300) || resource.url.slice(0, 300);

    const resourceRow = await db.query<{ id: string }>(
      `INSERT INTO public_contact_resources(
        source_url, source_type, title, processed_at, status, records_seen,
        emails_extracted, emails_normalized, invalid_emails, duplicate_emails, qualified_contacts
       ) VALUES($1,$2,$3,NOW(),'PROCESSED',$4,$5,$6,$7,0,$8)
       ON CONFLICT(source_url) DO UPDATE SET
         processed_at=EXCLUDED.processed_at,
         status=EXCLUDED.status,
         title=EXCLUDED.title,
         records_seen=EXCLUDED.records_seen,
         emails_extracted=EXCLUDED.emails_extracted,
         emails_normalized=EXCLUDED.emails_normalized,
         invalid_emails=EXCLUDED.invalid_emails,
         qualified_contacts=EXCLUDED.qualified_contacts
       RETURNING id`,
      [resource.url, type, title, emails.length, emails.length, emails.length,
       emails.filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)).length, qualified.length]
    );

    const resourceId = resourceRow.rows[0]?.id;
    let persisted = 0;
    let duplicates = 0;
    let invalid = 0;

    if (resourceId) {
      for (const item of emailContexts) {
        const status = await validation(item.email);
        if (status === "INVALID") {
          invalid += 1;
          continue;
        }

        const score = relevance(item.email, `${resource.url} ${item.context}`, [...profile.skills]);
        if (score < 60) continue;

        const domain = item.email.split("@")[1]?.toLowerCase();
        if (!domain) continue;

        const result = await db.query(
          `INSERT INTO public_contact_resource_contacts(
             resource_id, normalized_email, domain, validation_status, relevance_score,
             evidence_context, observed_at, updated_at
           ) VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())
           ON CONFLICT(resource_id, normalized_email) DO NOTHING
           RETURNING id`,
          [resourceId, item.email, domain, status, score, item.context.slice(0, 3500)]
        );

        if (result.rowCount === 1) persisted += 1;
        else duplicates += 1;
      }
    }

    if (resourceId) {
      await db.query(
        "UPDATE public_contact_resources SET duplicate_emails=$2, invalid_emails=$3 WHERE id=$1",
        [resourceId, duplicates, invalid]
      );
    }

    return { resource, type, emails: emails.length, qualified: qualified.length, persisted, duplicates, invalid, status: "PROCESSED" as const };
  });

  const ok = processed.filter((item) => item.status === "PROCESSED");
  const failed = processed.filter((item) => item.status === "FAILED");
  const totals = ok.reduce(
    (acc, item) => ({
      emails: acc.emails + item.emails,
      qualified: acc.qualified + item.qualified,
      persisted: acc.persisted + item.persisted,
      duplicates: acc.duplicates + item.duplicates,
      invalid: acc.invalid + item.invalid
    }),
    { emails: 0, qualified: 0, persisted: 0, duplicates: 0, invalid: 0 }
  );

  await db.close();

  console.log(JSON.stringify({
    status: "ok",
    feature: "PUBLIC_CONTACT_RESOURCE",
    independent: true,
    sendEnabled: false,
    resourcesDiscovered: resourceList.length,
    resourcesProcessed: ok.length,
    emailsExtracted: totals.emails,
    emailsNormalized: totals.emails,
    invalidEmails: totals.invalid,
    duplicateEmails: totals.duplicates,
    qualifiedContacts: totals.qualified,
    resourceContactsPersisted: totals.persisted,
    locationPriority: ["Bengaluru", "Bangalore", "India", "Remote"],
    formatsProcessed: [...new Set(ok.map((item) => item.type))],
    failedResources: failed.map((item) => ({
      url: item.resource.url, status: "FAILED", failureReason: item.failureReason,
      httpStatus: item.httpStatus, contentType: item.contentType, finalUrl: item.finalUrl,
      bytesRead: item.bytesRead, elapsedMs: item.elapsedMs, errorCode: item.errorCode
    })),
    maxResourceBytes: Number(process.env.PUBLIC_CONTACT_RESOURCE_MAX_BYTES ?? 8 * 1024 * 1024),
    results: ok.filter((item) => item.emails > 0).slice(0, 20).map((item) => ({
      source: item.resource.url, sourceType: item.type, emailsExtracted: item.emails,
      qualifiedContacts: item.qualified, persisted: item.persisted
    }))
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      status: "FAILED",
      feature: "PUBLIC_CONTACT_RESOURCE",
      error: error instanceof Error ? error.message : String(error)
    }, null, 2));
    process.exitCode = 1;
  });
}
