import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const OBFUSCATED_EMAIL_PATTERN = /([A-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\{at\}|\s+at\s+)\s*([A-Z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\{dot\}|\s+dot\s+)\s*([A-Z]{2,})/gi;
const RECRUITING_CONTEXT = /(recruiter|recruiting|talent(?:\s+acquisition)?|hiring|human\s*resources|\bhr\b|people\s*(?:team|ops)|careers?|staffing|jobs?\s+team|join\s+us|work\s+with\s+us)/i;
const NON_RECRUITING_CONTEXT = /(technical\s+questions?|engineering\s+questions?|customer\s+support|technical\s+support|support\s+questions?|sales|billing|privacy|legal|security|press|media|partnerships?)/i;
const GENERIC_RECRUITING_LOCAL_PARTS = /^(careers?|jobs?|job|recruiting|recruitment|talent|talentacquisition|hr|people|hiring|staffing|joinus|workwithus|humanresources|resourcing)$/i;
const PUBLIC_PATHS = [
  "/", "/careers", "/career", "/jobs", "/job", "/join-us", "/joinus", "/work-with-us", "/workwithus",
  "/about/careers", "/company/careers", "/talent", "/recruiting", "/people", "/hr", "/contact", "/contact-us",
  "/sitemap.xml", "/sitemap_index.xml"
] as const;
const SITEMAP_RELEVANCE = /(career|job|join|work-with-us|talent|recruit|hiring|people|hr|contact)/i;

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";
}
function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
function isCompanyEmail(email: string, domain: string): boolean { return normalizeEmail(email).split("@")[1] === domain; }
function localPart(email: string): string { return normalizeEmail(email).split("@")[0] ?? ""; }
function looksLikeRecruitingMailbox(email: string): boolean {
  const local = localPart(email).replace(/[._+-]/g, "");
  return GENERIC_RECRUITING_LOCAL_PARTS.test(local) || /^(recruit|talent|hr|hiring|career|jobs?)/i.test(local);
}

function contextAround(text: string, index: number): string {
  const startCandidates = [text.lastIndexOf(".", index - 1), text.lastIndexOf("!", index - 1), text.lastIndexOf("?", index - 1), text.lastIndexOf("\n", index - 1), text.lastIndexOf(">", index - 1)];
  const sentenceStart = Math.max(...startCandidates) + 1;
  const endCandidates = [text.indexOf(".", index), text.indexOf("!", index), text.indexOf("?", index), text.indexOf("\n", index), text.indexOf("<", index)].filter((position) => position !== -1);
  const sentenceEnd = endCandidates.length > 0 ? Math.min(...endCandidates) : text.length;
  return text.slice(sentenceStart, sentenceEnd);
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#64;|&#x40;/gi, "@")
    .replace(/&#46;|&#x2e;/gi, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeObfuscatedEmails(text: string): string {
  return text.replace(OBFUSCATED_EMAIL_PATTERN, (_match, local: string, domain: string, tld: string) => `${local}@${domain}.${tld}`);
}

function isRecruitingContextForEmail(email: string, context: string): boolean {
  if (NON_RECRUITING_CONTEXT.test(context)) return false;
  return RECRUITING_CONTEXT.test(context) || looksLikeRecruitingMailbox(email);
}

export function extractExplicitRecruiterEmails(jobDescription: string, companyDomain: string): string[] {
  return extractRecruiterEmailsFromPublicText(jobDescription, companyDomain);
}

function extractRecruiterEmailsFromPublicText(text: string, companyDomain: string): string[] {
  const domain = normalizeDomain(companyDomain);
  if (!domain) return [];
  const normalizedText = normalizeObfuscatedEmails(text ?? "");
  const found = new Set<string>();
  const matches = [
    ...[...(normalizedText.matchAll(EMAIL_PATTERN))].map((match) => ({ value: match[0], index: match.index ?? -1 })),
    ...[...((normalizedText.matchAll(/mailto:([^\s"'<>?#]+)/gi)))].map((match) => ({ value: match[1], index: match.index ?? -1 }))
  ];
  for (const match of matches) {
    if (!match.value || match.index < 0) continue;
    const email = normalizeEmail(match.value.replace(/^mailto:/i, "").replace(/[),;]+$/g, ""));
    if (!isCompanyEmail(email, domain) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    const context = contextAround(normalizedText, match.index);
    if (!isRecruitingContextForEmail(email, context)) continue;
    found.add(email);
  }
  return [...found];
}

function extractSitemapUrls(xml: string, domain: string): string[] {
  const urls = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi)) {
    const raw = match[1];
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (normalizeDomain(url.hostname) !== domain) continue;
      if (SITEMAP_RELEVANCE.test(`${url.pathname}${url.search}`)) urls.add(url.toString());
    } catch { /* ignore malformed sitemap entries */ }
  }
  return [...urls].slice(0, 25);
}

async function fetchText(url: string, timeoutMs = 5000): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
        "user-agent": "job-agent-public-recruiter-discovery/2.0"
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

async function fetchPublicCompanyPages(companyDomain: string): Promise<Array<{ url: string; text: string }>> {
  const domain = normalizeDomain(companyDomain);
  if (!domain) return [];
  const urls = PUBLIC_PATHS.map((path) => `https://${domain}${path}`);
  const initial = await Promise.all(urls.map(async (url) => ({ url, text: await fetchText(url) })));
  const pages = initial.filter((page): page is { url: string; text: string } => Boolean(page.text));
  const sitemapUrls = pages.flatMap((page) => /<sitemapindex/i.test(page.text) || /<urlset/i.test(page.text) ? extractSitemapUrls(page.text, domain) : []);
  const discoveredUrls = [...new Set(sitemapUrls)].slice(0, 25);
  if (discoveredUrls.length === 0) return pages;
  const sitemapPages = await Promise.all(discoveredUrls.map(async (url) => ({ url, text: await fetchText(url) })));
  return [...pages, ...sitemapPages.filter((page): page is { url: string; text: string } => Boolean(page.text))];
}

export class JobPostingRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "job-posting";

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const pages = await fetchPublicCompanyPages(input.companyDomain);
    const sources = [{ url: "job-description", text: input.jobDescription }, ...pages];
    const contacts = new Map<string, RecruiterContactCandidate>();

    for (const source of sources) {
      const normalizedText = normalizeObfuscatedEmails(source.text ?? "");
      for (const email of extractRecruiterEmailsFromPublicText(normalizedText, input.companyDomain)) {
        const isJobPosting = source.url === "job-description";
        const confidence = isJobPosting ? 100 : looksLikeRecruitingMailbox(email) ? 96 : 88;
        const existing = contacts.get(email);
        const sourceEntry = { url: isJobPosting ? undefined : source.url, type: isJobPosting ? "job_posting" : "public_company_page", confidence };
        if (existing) {
          existing.sources.push(sourceEntry);
          existing.confidence = Math.max(existing.confidence ?? 0, confidence);
        } else {
          contacts.set(email, {
            email,
            title: looksLikeRecruitingMailbox(email) ? "Recruiting contact from public company source" : "Recruiting contact from public company source",
            department: "recruiting",
            confidence,
            verified: false,
            verificationStatus: "unverified_public_source",
            provider: this.name,
            sources: [sourceEntry]
          });
        }
      }
    }

    return { provider: this.name, contacts: [...contacts.values()], discoveredAt: new Date() };
  }

  async verify(email: string): Promise<RecruiterVerificationResult> {
    return { email: normalizeEmail(email), verified: false, status: "verification_provider_required", confidence: 0 };
  }
}
