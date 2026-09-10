import { promises as dns } from "node:dns";
import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

const EMAIL_PATTERN = /[A-Z0-9._+\-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const RECRUITING_CONTEXT = /(recruiter|recruiting|talent acquisition|talent partner|talent acquisition partner|technical recruiter|engineering recruiter|hiring manager|human resources|\bhr\b|careers?|staffing|hiring|campus recruiter|campus hiring|people operations|people ops|recruitment)/i;
const NON_RECRUITING_CONTEXT = /(customer support|technical support|sales|billing|privacy|legal|security|press|media|partnerships?|helpdesk|help desk|procurement|accounting|finance)/i;
const GENERIC_RECRUITING_LOCAL_PARTS = /^(careers?|jobs?|job|recruiting|recruitment|talent|talentacquisition|hr|people|hiring|staffing|joinus|workwithus|humanresources|resourcing|campushiring|campusrecruiting)$/i;
const LINKEDIN_PROFILE_PATTERN = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const SEARCH_CONCURRENCY = 4;
const SEARCH_TIMEOUT_MS = 7000;
const EMPLOYER_PAGE_TIMEOUT_MS = 6000;
const EMPLOYER_PAGE_PATHS = ["/careers", "/jobs", "/careers/jobs", "/about/careers", "/join-us", "/work-with-us"];

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";
}

function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#64;|&#x40;/gi, "@")
    .replace(/&#46;|&#x2e;/gi, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function emailContext(text: string, index: number): string {
  const start = Math.max(0, index - 280);
  const end = Math.min(text.length, index + 280);
  return text.slice(start, end);
}

function isCompanyEmail(email: string, domain: string): boolean {
  return normalizeEmail(email).endsWith(`@${domain}`);
}

export function isPlausibleRecruiterEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  const localPart = normalized.split("@")[0] ?? "";
  if (/%[0-9a-f]{2}/i.test(normalized)) return false;
  if (/^[^@]+%[^@]*@/i.test(normalized)) return false;
  if (!/^[a-z0-9][a-z0-9._+\-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return false;
  if (/^\d+$/.test(localPart)) return false;
  if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) return false;
  return true;
}

function looksLikeRecruitingMailbox(email: string): boolean {
  const local = normalizeEmail(email).split("@")[0]?.replace(/[._+\-]/g, "") ?? "";
  return GENERIC_RECRUITING_LOCAL_PARTS.test(local) || /^(recruit|talent|hr|hiring|career|jobs?)/i.test(local);
}

function isRecruitingEmailContext(email: string, context: string): boolean {
  if (NON_RECRUITING_CONTEXT.test(context)) return false;
  return RECRUITING_CONTEXT.test(context) || looksLikeRecruitingMailbox(email);
}

function extractEmails(text: string, domain: string): Array<{ email: string; context: string }> {
  const normalized = stripHtml(text ?? "");
  const found = new Map<string, { email: string; context: string }>();
  for (const match of normalized.matchAll(EMAIL_PATTERN)) {
    const email = normalizeEmail(match[0] ?? "");
    if (!email || !isPlausibleRecruiterEmail(email) || !isCompanyEmail(email, domain)) continue;
    const context = emailContext(normalized, match.index ?? 0);
    if (isRecruitingEmailContext(email, context)) found.set(email, { email, context });
  }
  return [...found.values()];
}

function extractLinkedInProfiles(text: string): string[] {
  return [...new Set(text.match(LINKEDIN_PROFILE_PATTERN) ?? [])].slice(0, 10);
}

function searchUrls(query: string): string[] {
  const encoded = encodeURIComponent(query);
  return [
    `https://r.jina.ai/https://www.google.com/search?q=${encoded}&gbv=1`,
    `https://r.jina.ai/https://www.bing.com/search?q=${encoded}`,
    `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encoded}`
  ];
}

async function fetchText(url: string, timeoutMs = SEARCH_TIMEOUT_MS): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/plain,text/html,application/xhtml+xml,*/*;q=0.8",
        "user-agent": "job-agent-public-recruiter-discovery/6.0"
      }
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

function buildQueries(input: RecruiterDiscoveryInput): string[] {
  const company = input.companyName.trim();
  const domain = normalizeDomain(input.companyDomain);
  const title = input.jobTitle.trim();
  return [
    `site:linkedin.com/in "${company}" "${title}" recruiter`,
    `site:linkedin.com/in "${company}" recruiter Bengaluru`,
    `site:linkedin.com/in "${company}" "talent acquisition" India`,
    `"${company}" "@${domain}" recruiter`,
    `"${company}" "@${domain}" "talent acquisition"`,
    `"${company}" "@${domain}" "technical recruiter"`,
    `"${company}" "@${domain}" "hiring manager"`,
    `"${company}" recruiter "${title}" India`,
    `site:${domain} (careers OR recruiting OR hiring OR "talent acquisition") "@${domain}"`,
    `site:${domain} (recruiter OR "talent partner" OR "people ops") "@${domain}"`
  ];
}

async function fetchEmployerRecruitingPages(domain: string): Promise<Array<{ url: string; text: string }>> {
  const urls = EMPLOYER_PAGE_PATHS.map((path) => `https://${domain}${path}`);
  const pages = await mapWithConcurrency(urls, SEARCH_CONCURRENCY, async (url) => {
    const text = await fetchText(url, EMPLOYER_PAGE_TIMEOUT_MS);
    return text ? { url, text } : null;
  });
  return pages.filter((page): page is { url: string; text: string } => Boolean(page));
}

async function verifyMxViaDnsOverHttps(domain: string): Promise<boolean | null> {
  const endpoints = [
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
    `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`
  ];
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(endpoint, { signal: controller.signal, headers: { accept: "application/dns-json" } });
      if (!response.ok) continue;
      const payload = await response.json() as { Answer?: Array<{ type?: number }> };
      const answers = Array.isArray(payload.Answer) ? payload.Answer : [];
      return answers.some((answer) => answer.type === 15);
    } catch {
      // Try the next public DNS-over-HTTPS resolver.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

export class PublicRecruiterSearchProvider implements RecruiterDiscoveryProvider {
  readonly name = "public-web";

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const domain = normalizeDomain(input.companyDomain);
    const contacts = new Map<string, RecruiterContactCandidate>();
    const queries = buildQueries(input);

    const queryPages = await mapWithConcurrency(queries, SEARCH_CONCURRENCY, async (query) => {
      const responses = await Promise.all(searchUrls(query).map((url) => fetchText(url)));
      return responses.filter((response): response is string => Boolean(response)).map((text) => ({ url: null as string | null, text }));
    });

    const searchPages = queryPages.flat();
    const employerPages = await fetchEmployerRecruitingPages(domain);
    const pages = [...searchPages, ...employerPages];

    for (const page of pages) {
      const text = stripHtml(page.text);
      const linkedIn = extractLinkedInProfiles(page.text);
      for (const match of extractEmails(page.text, domain)) {
        const existing = contacts.get(match.email);
        const source = {
          type: page.url ? "employer_recruiting_page" : "public_search_result",
          confidence: page.url ? 95 : 92,
          ...(page.url ? { url: page.url } : {})
        };
        const linkedin = linkedIn.find((url) => text.toLowerCase().includes(url.toLowerCase()));
        if (existing) {
          existing.confidence = Math.min(100, (existing.confidence ?? 0) + 2);
          existing.sources.push(source);
          if (!existing.linkedinProfileUrl && linkedin) existing.linkedinProfileUrl = linkedin;
          continue;
        }
        contacts.set(match.email, {
          email: match.email,
          title: "Recruiting contact from public source",
          department: "recruiting",
          confidence: linkedin ? 97 : looksLikeRecruitingMailbox(match.email) ? 94 : page.url ? 95 : 92,
          verified: false,
          verificationStatus: "unverified_public_source",
          provider: this.name,
          linkedinProfileUrl: linkedin,
          sources: [source]
        });
      }
    }

    return {
      provider: this.name,
      contacts: [...contacts.values()].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
      discoveredAt: new Date()
    };
  }

  async verify(email: string): Promise<RecruiterVerificationResult> {
    const normalized = normalizeEmail(email);
    if (!isPlausibleRecruiterEmail(normalized)) return { email: normalized, verified: false, status: "invalid_email_format", confidence: 0 };
    const domain = normalized.split("@")[1] ?? "";
    if (!domain) return { email: normalized, verified: false, status: "missing_email_domain", confidence: 0 };

    try {
      const records = await dns.resolveMx(domain);
      if (records.length > 0) return { email: normalized, verified: true, status: "domain_mx_verified", confidence: 75 };
      return { email: normalized, verified: false, status: "no_mx_record", confidence: 0 };
    } catch {
      const dohResult = await verifyMxViaDnsOverHttps(domain);
      if (dohResult === true) return { email: normalized, verified: true, status: "domain_mx_verified_doh", confidence: 75 };
      if (dohResult === false) return { email: normalized, verified: false, status: "no_mx_record", confidence: 0 };
      return { email: normalized, verified: false, status: "mx_lookup_failed", confidence: 0 };
    }
  }
}
