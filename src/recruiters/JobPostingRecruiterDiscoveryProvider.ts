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
const LINKEDIN_RECRUITER_TERMS = ["recruiter", "recruiting", "talent acquisition", "talent partner", "technical recruiter", "hr", "human resources", "hiring manager"];

type PublicLinkedInProfile = { name: string; title?: string; url: string; snippet: string };

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
function normalizeObfuscatedEmails(text: string): string {
  return text.replace(OBFUSCATED_EMAIL_PATTERN, (_match, local: string, domain: string, tld: string) => `${local}@${domain}.${tld}`);
}
function isRecruitingContextForEmail(email: string, context: string): boolean {
  if (NON_RECRUITING_CONTEXT.test(context)) return false;
  return RECRUITING_CONTEXT.test(context) || looksLikeRecruitingMailbox(email);
}
function stripHtml(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#64;|&#x40;/gi, "@").replace(/&#46;|&#x2e;/gi, ".").replace(/\s+/g, " ").trim();
}
function isStrongNameEmailMatch(email: string, name: string): boolean {
  const local = localPart(email).replace(/[^a-z0-9]/gi, "").toLowerCase();
  const parts = name.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  if (parts.length < 2 || local.length < 4) return false;
  const first = parts[0] ?? "";
  const last = parts[parts.length - 1] ?? "";
  return (first.length >= 3 && local.includes(first) && last.length >= 3 && local.includes(last)) || local === `${first}${last}` || local === `${first[0]}${last}`;
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
    ...[...normalizedText.matchAll(/mailto:([^\s"'<>?#]+)/gi)].map((match) => ({ value: match[1], index: match.index ?? -1 }))
  ];
  for (const match of matches) {
    if (!match.value || match.index < 0) continue;
    const email = normalizeEmail(match.value.replace(/^mailto:/i, "").replace(/[),;]+$/g, ""));
    if (!isCompanyEmail(email, domain) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (!isRecruitingContextForEmail(email, contextAround(normalizedText, match.index))) continue;
    found.add(email);
  }
  return [...found];
}
function extractSitemapLocs(xml: string, domain: string, filterRelevant: boolean): string[] {
  const urls = new Set<string>();
  for (const match of xml.matchAll(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi)) {
    const raw = match[1];
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (normalizeDomain(url.hostname) !== domain) continue;
      if (filterRelevant && !SITEMAP_RELEVANCE.test(`${url.pathname}${url.search}`)) continue;
      urls.add(url.toString());
    } catch { /* ignore malformed sitemap entries */ }
  }
  return [...urls].slice(0, 25);
}
async function fetchText(url: string, timeoutMs = 5000): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept: "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8", "user-agent": "job-agent-public-recruiter-discovery/3.2" } });
    if (!response.ok) return null;
    return await response.text();
  } catch { return null; } finally { clearTimeout(timeout); }
}
async function fetchPublicCompanyPages(companyDomain: string): Promise<Array<{ url: string; text: string }>> {
  const domain = normalizeDomain(companyDomain);
  if (!domain) return [];
  const urls = PUBLIC_PATHS.map((path) => `https://${domain}${path}`);
  const initial = await Promise.all(urls.map(async (url) => ({ url, text: await fetchText(url) })));
  const pages = initial.filter((page): page is { url: string; text: string } => Boolean(page.text));
  const sitemapCandidates = pages.flatMap((page) => /<sitemapindex/i.test(page.text) ? extractSitemapLocs(page.text, domain, false) : /<urlset/i.test(page.text) ? extractSitemapLocs(page.text, domain, true) : []);
  const discoveredUrls = [...new Set(sitemapCandidates)].slice(0, 25);
  if (discoveredUrls.length === 0) return pages;
  const discovered = await Promise.all(discoveredUrls.map(async (url) => ({ url, text: await fetchText(url) })));
  const discoveredPages = discovered.filter((page): page is { url: string; text: string } => Boolean(page.text));
  const nestedRelevant = discoveredPages.flatMap((page) => /<sitemapindex/i.test(page.text) ? extractSitemapLocs(page.text, domain, true) : []);
  if (nestedRelevant.length === 0) return [...pages, ...discoveredPages];
  const nestedPages = await Promise.all([...new Set(nestedRelevant)].slice(0, 25).map(async (url) => ({ url, text: await fetchText(url) })));
  return [...pages, ...discoveredPages, ...nestedPages.filter((page): page is { url: string; text: string } => Boolean(page.text))];
}

function searchUrl(query: string): string {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}
function parsePublicLinkedInProfiles(html: string): PublicLinkedInProfile[] {
  const results: PublicLinkedInProfile[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const rawUrl = match[1] ?? "";
    const label = stripHtml(match[2] ?? "");
    let decoded = rawUrl.replace(/&amp;/g, "&");
    try {
      if (decoded.startsWith("//")) decoded = `https:${decoded}`;
      const target = new URL(decoded);
      if (target.hostname !== "www.linkedin.com" && target.hostname !== "linkedin.com") continue;
      const profilePath = target.pathname.match(/^\/in\/([^/?#]+)/i);
      if (!profilePath || !label) continue;
      const url = `https://www.linkedin.com/in/${profilePath[1]}`;
      if (seen.has(url)) continue;
      const normalizedLabel = label.replace(/\s*\|\s*LinkedIn.*$/i, "").trim();
      if (!normalizedLabel || normalizedLabel.length > 100) continue;
      const parts = normalizedLabel.split(/\s+-\s+|\s+\|\s+/).map((v) => v.trim()).filter(Boolean);
      const name = parts[0] ?? normalizedLabel;
      const title = parts.slice(1).join(" - ") || undefined;
      seen.add(url);
      results.push({ name, title, url, snippet: normalizedLabel });
    } catch { /* ignore search-engine tracking links */ }
  }
  return results.slice(0, 10);
}

async function discoverPublicLinkedInEvidence(companyName: string, companyDomain: string, jobTitle: string): Promise<{ profiles: PublicLinkedInProfile[]; emails: string[] }> {
  const domain = normalizeDomain(companyDomain);
  const queries = [
    `site:linkedin.com/in "${companyName}" recruiter`,
    `site:linkedin.com/in "${companyName}" "talent acquisition"`,
    `site:linkedin.com/in "${companyName}" "technical recruiter"`,
    `site:linkedin.com/in "${companyName}" "hiring manager"`,
    `site:linkedin.com/in "${companyName}" "@${domain}" recruiter`,
    `site:linkedin.com "${companyName}" "@${domain}" recruiter`,
    `"${companyName}" "@${domain}" recruiter`,
    `"${companyName}" "@${domain}" "talent acquisition"`
  ];
  const pages = await Promise.all(queries.map(async (query) => fetchText(searchUrl(`${query} "${jobTitle}"`), 7000)));
  const profiles = new Map<string, PublicLinkedInProfile>();
  const emails = new Set<string>();
  for (const page of pages) {
    if (!page) continue;
    for (const profile of parsePublicLinkedInProfiles(page)) profiles.set(profile.url, profile);
    for (const email of extractRecruiterEmailsFromPublicText(stripHtml(page), domain)) emails.add(email);
  }
  return {
    profiles: [...profiles.values()].filter((profile) => {
      const haystack = `${profile.name} ${profile.title ?? ""} ${profile.snippet}`.toLowerCase();
      return LINKEDIN_RECRUITER_TERMS.some((term) => haystack.includes(term));
    }).slice(0, 10),
    emails: [...emails]
  };
}

export class JobPostingRecruiterDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "public-web";

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const [{ profiles: linkedinProfiles, emails: searchEmails }, pages] = await Promise.all([
      discoverPublicLinkedInEvidence(input.companyName, input.companyDomain, input.jobTitle),
      fetchPublicCompanyPages(input.companyDomain)
    ]);
    const sources = [{ url: "job-description", text: input.jobDescription }, ...pages];
    const contacts = new Map<string, RecruiterContactCandidate>();

    for (const source of sources) {
      const normalizedText = normalizeObfuscatedEmails(source.text ?? "");
      const searchableText = source.url === "job-description" ? normalizedText : stripHtml(normalizedText);
      for (const email of extractRecruiterEmailsFromPublicText(searchableText, input.companyDomain)) {
        const isJobPosting = source.url === "job-description";
        const confidence = isJobPosting ? 100 : looksLikeRecruitingMailbox(email) ? 96 : 88;
        const sourceEntry = { url: isJobPosting ? undefined : source.url, type: isJobPosting ? "job_posting" : "public_company_page", confidence };
        const existing = contacts.get(email);
        if (existing) { existing.sources.push(sourceEntry); existing.confidence = Math.max(existing.confidence ?? 0, confidence); }
        else contacts.set(email, { email, title: "Recruiting contact from public company source", department: "recruiting", confidence, verified: false, verificationStatus: "unverified_public_source", provider: this.name, sources: [sourceEntry] });
      }
    }

    for (const email of searchEmails) {
      const existing = contacts.get(email);
      if (existing) {
        existing.sources.push({ type: "public_search_result", confidence: 92 });
        existing.confidence = Math.max(existing.confidence ?? 0, 92);
        continue;
      }
      contacts.set(email, {
        email,
        title: "Recruiting contact from public search result",
        department: "recruiting",
        confidence: looksLikeRecruitingMailbox(email) ? 94 : 90,
        verified: false,
        verificationStatus: "unverified_public_source",
        provider: this.name,
        sources: [{ type: "public_search_result", confidence: 92 }]
      });
    }

    for (const contact of contacts.values()) {
      const match = linkedinProfiles.find((profile) => isStrongNameEmailMatch(contact.email, profile.name));
      if (!match) continue;
      contact.fullName = match.name;
      contact.title = match.title || "Recruiting / Talent Acquisition";
      contact.linkedinProfileUrl = match.url;
      contact.confidence = Math.min(100, (contact.confidence ?? 0) + 5);
      contact.sources.push({ url: match.url, type: "public_linkedin_search", confidence: 95 });
    }

    return { provider: this.name, contacts: [...contacts.values()].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)), discoveredAt: new Date() };
  }

  async verify(email: string): Promise<RecruiterVerificationResult> {
    return { email: normalizeEmail(email), verified: false, status: "verification_provider_required", confidence: 0 };
  }
}
