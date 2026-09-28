import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult
} from "./RecruiterDiscovery";
import { PublicRecruiterSearchProvider } from "./PublicRecruiterSearchProvider";

type SearchSource = { id: string; url: string };
type SourceStat = {
  attempted: number;
  succeeded: number;
  empty: number;
  timeouts: number;
  http403: number;
  http429: number;
  http5xx: number;
  otherHttpErrors: number;
  parseablePages: number;
  usefulPages: number;
  candidates: number;
  duplicateCandidates: number;
  lastError?: string;
};

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const LINKEDIN_POST = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/(?:posts\/[^\s<>"')\]]+|feed\/update\/urn:li:activity:\d+)/gi;
const LINKEDIN_PROFILE = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const HIRING = /(?:we['’]?re\s+hiring|we\s+are\s+hiring|i['’]?m\s+hiring|i\s+am\s+hiring|my\s+team\s+is\s+hiring|our\s+team\s+is\s+hiring|we['’]?re\s+looking\s+for|we\s+are\s+looking\s+for|hiring\s*[:\-]|open\s+(?:position|role)|send\s+(?:your|me\s+your)\s+(?:resume|cv)|share\s+(?:your|an\s+updated)\s+(?:resume|cv)|dm\s+(?:me|us)|reach\s+out|apply\s+(?:here|now)|referrals?\s+welcome|join\s+(?:our|my)\s+team)/i;
const RECRUITER_ROLE = /recruiter|recruiting|talent acquisition|talent partner|talent sourcer|technical sourcer|technical recruiter|engineering recruiter|hiring manager|hr professional|human resources|staffing|people operations|people partner|talent advisor|hiring lead|founder|co-founder|cofounder/i;
const NON_RECRUITER = /customer support|technical support|sales executive|account(?:s)? executive|accounting|finance|marketing|press|media|legal|privacy|customer success/i;
const GENERIC_EMAIL_DOMAIN = /^(?:gmail|outlook|hotmail|yahoo|icloud|proton(?:mail)?)[.]com$|^proton[.]me$/i;
const NON_RECRUITING_LOCAL_PART = /^(?:noreply|no-reply|postmaster|webmaster|admin|support|info|press|media|legal|privacy|marketing|sales|security|billing|helpdesk|hello|contact|feedback)$/i;
const RECRUITING_LOCAL_PART = /^(?:hr|hiring|recruit(?:er|ing)?|talent|careers?|jobs?|people|peopleops|talentacquisition)$/i;
const ROLE_TERMS = /(?:frontend|front-end|react(?:\.js)?|next\.js|javascript|typescript|full[ -]?stack|mern|web developer|software engineer|application developer|ui engineer|product engineer|developer|engineer)/i;
const SKILLS = [
  "React", "React.js", "Next.js", "TypeScript", "JavaScript", "Node.js", "Express.js", "MongoDB", "REST APIs", "GraphQL", "Redux", "Redux Toolkit", "Tailwind CSS", "HTML", "CSS", "Jest", "Playwright", "Docker", "Git/GitHub"
];
const SEARCH_HOSTS = new Set(["google.com", "www.google.com", "bing.com", "www.bing.com", "duckduckgo.com", "html.duckduckgo.com", "startpage.com", "www.startpage.com", "search.yahoo.com", "www.yahoo.com", "search.brave.com", "www.mojeek.com", "qwant.com", "www.qwant.com"]);
const MAX_QUERIES = 12;
const MAX_RESULTS_PER_SOURCE = 12;
const MAX_CONTACTS = 25;
const DISCOVERY_TIMEOUT_MS = 45_000;

function clean(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#64;|&#x40;/gi, "@")
    .replace(/\s+/g, " ")
    .trim();
}

function domainOf(email: string): string | undefined {
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return domain && !GENERIC_EMAIL_DOMAIN.test(domain) ? domain : undefined;
}

function canonical(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingId", "refId", "lipi"].forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/$/, "");
  }
}

function plausibleName(value: string): boolean {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 5 || name.length > 80) return false;
  if (/^(?:the|we|our|my|team|hiring|frontend|react|software|developer|engineer|post)\b/i.test(name)) return false;
  const parts = name.split(" ");
  return parts.length >= 2 && parts.length <= 5 && parts.every((part) => /^[A-Z][A-Za-z.'-]*$/.test(part));
}

function extractName(text: string): string | undefined {
  const patterns = [
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})['’]s\s+(?:Post|post)\b/,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:2d|3d|4d|5d|6d|1w|2w|3w|4w|1mo|2mo|3mo|4mo|5mo|6mo)\b/i,
    /\b(?:DM|contact|reach out to|email)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1]?.trim();
    if (match && plausibleName(match)) return match;
  }
  return undefined;
}

function extractRole(text: string, input: RecruiterDiscoveryInput): string {
  const explicit = text.match(/(?:hiring|looking for|open position|open role|role)\s*[:\-–—]?\s*(?:a|an)?\s*([A-Za-z][A-Za-z0-9+.#/()& -]{2,90})(?=\s*(?:\||\.|,|\n|📍|💼|experience|location|skills|required|$))/i)?.[1]?.trim();
  if (explicit && ROLE_TERMS.test(explicit)) return explicit;
  if (ROLE_TERMS.test(input.jobTitle)) return input.jobTitle;
  const titleLine = text.match(/(?:^|\s)([A-Z][A-Za-z0-9+.#/()& -]{2,70}(?:Developer|Engineer))(?:\s|$)/)?.[1]?.trim();
  return titleLine || input.jobTitle;
}

function extractSkills(text: string): string[] {
  const lower = text.toLowerCase();
  return [...new Set(SKILLS.filter((skill) => lower.includes(skill.toLowerCase())))].slice(0, 12);
}

function extractLocation(text: string): string | undefined {
  const match = text.match(/(?:📍|location|based in|work location)\s*[:\-]?\s*([^|\n]{2,70})/i)?.[1]?.trim();
  return match?.replace(/(?:💼|experience|work mode|employment type).*$/i, "").trim() || undefined;
}

function extractExperience(text: string): string | undefined {
  return text.match(/(?:experience|exp)\s*[:\-]?\s*(\d+\s*(?:-|to|–|—)\s*\d+\s*years?|\d+\+?\s*years?)/i)?.[1]?.trim();
}

function sourceList(query: string): SearchSource[] {
  const q = encodeURIComponent(query);
  return [
    { id: "google", url: `https://r.jina.ai/https://www.google.com/search?q=${q}&gbv=1` },
    { id: "bing", url: `https://r.jina.ai/https://www.bing.com/search?q=${q}` },
    { id: "duckduckgo", url: `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${q}` },
    { id: "startpage", url: `https://r.jina.ai/https://www.startpage.com/sp/search?query=${q}` }
  ];
}

async function fetchText(url: string, signal?: AbortSignal): Promise<{ text: string; status: number } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/plain,text/html,application/xhtml+xml,*/*;q=0.8",
        "user-agent": "job-agent-public-search/1.0"
      }
    });
    if (!response.ok) return { text: "", status: response.status };
    return { text: await response.text(), status: response.status };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

function extractUrls(text: string): string[] {
  return [...new Set((text.match(LINKEDIN_POST) ?? []).map(canonical))];
}

function extractEmails(text: string): string[] {
  return [...new Set((text.match(EMAIL) ?? []).map((email) => email.toLowerCase()))];
}

function emailIsRecruiting(email: string, text: string): boolean {
  const domain = domainOf(email);
  if (!domain) return false;
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (NON_RECRUITING_LOCAL_PART.test(local)) return false;
  const index = text.toLowerCase().indexOf(email.toLowerCase());
  const context = index >= 0 ? text.slice(Math.max(0, index - 600), Math.min(text.length, index + 600)) : text;
  if (RECRUITING_LOCAL_PART.test(local)) return /(?:hiring|recruit|talent|resume|cv|job|career|apply|join|vacanc)/i.test(context);
  return /(?:send|share|email|contact|reach out|resume|cv|apply|hiring|recruiting|recruiter|talent|job|join|career)/i.test(context);
}

function companyDomainFromInput(input: RecruiterDiscoveryInput): string | undefined {
  const value = input.companyDomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  return value && !GENERIC_EMAIL_DOMAIN.test(value) ? value : undefined;
}

function candidateFromText(text: string, postUrl: string, input: RecruiterDiscoveryInput): RecruiterContactCandidate | null {
  const normalized = clean(text);
  if (!HIRING.test(normalized) || !ROLE_TERMS.test(normalized)) return null;

  const emails = extractEmails(normalized).filter((email) => emailIsRecruiting(email, normalized));
  const email = emails[0];
  const name = extractName(normalized);
  const profileUrl = [...new Set((normalized.match(LINKEDIN_PROFILE) ?? []).map(canonical))][0];
  const recruiterLike = RECRUITER_ROLE.test(normalized);
  const explicitHiringAction = HIRING.test(normalized);
  if (!name && !email) return null;
  if (!recruiterLike && !email && !explicitHiringAction) return null;
  if (NON_RECRUITER.test(normalized) && !recruiterLike && !email) return null;

  const skills = extractSkills(normalized);
  const role = extractRole(normalized, input);
  const location = extractLocation(normalized) ?? input.location;
  const experience = extractExperience(normalized);
  const companyDomain = companyDomainFromInput(input) ?? domainOf(email ?? "");
  const score = Math.min(100, 45 + skills.length * 4 + (email ? 18 : 0) + (name ? 15 : 0) + (profileUrl ? 12 : 0) + (recruiterLike ? 8 : 0));
  const evidence = [
    `LinkedIn hiring post: ${postUrl}`,
    `Hiring evidence: ${normalized.slice(0, 1200)}`,
    `Role: ${role}`,
    skills.length ? `Skills: ${skills.join(", ")}` : "",
    location ? `Location: ${location}` : "",
    experience ? `Experience: ${experience}` : "",
    email ? `Public contact: ${email}` : ""
  ].filter(Boolean);

  return {
    email: email ?? "",
    fullName: name ?? (email ? "Employer recruiting contact" : undefined),
    title: recruiterLike ? "Recruiter / Hiring Contact" : "Hiring Contact",
    department: "Recruiting",
    confidence: score / 100,
    verified: false,
    verificationStatus: email ? "public_hiring_post_unverified" : "public_hiring_post_identity",
    provider: "linkedin-hiring-post",
    linkedinProfileUrl: profileUrl,
    companyDomain,
    location,
    recruitingContext: normalized.slice(0, 1400),
    discoveryEvidence: evidence,
    discoveredAt: new Date(),
    sources: [{ url: postUrl, type: "linkedin_hiring_post", confidence: score / 100 }]
  };
}

function freshMetrics(sourceStats: Record<string, SourceStat>, queriesGenerated: number, queriesExecuted: number, contacts: number, urls: number, rejected: number) {
  return {
    queriesGenerated,
    queriesExecuted,
    queriesSkipped: Math.max(0, queriesGenerated - queriesExecuted),
    rawPages: Object.values(sourceStats).reduce((sum, stat) => sum + stat.succeeded, 0),
    uniqueUrls: urls,
    linkedinUrls: urls,
    recruiterCandidates: contacts,
    duplicateCandidates: Object.values(sourceStats).reduce((sum, stat) => sum + stat.duplicateCandidates, 0),
    rejectedCandidates: rejected,
    sourceStats
  };
}

export class LinkedInHiringPostDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "linkedin-hiring-posts";
  private readonly verifier = new PublicRecruiterSearchProvider();

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const timeoutSignal = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
    const signal = input as RecruiterDiscoveryInput & { signal?: AbortSignal };
    const combinedSignal = signal.signal ? AbortSignal.any([signal.signal, timeoutSignal]) : timeoutSignal;
    const title = input.jobTitle.trim() || "Frontend Developer";
    const location = input.location?.trim() || "India";
    const company = input.companyName.trim();
    const tech = extractSkills(input.jobDescription).slice(0, 5).join(" ") || "React Next.js TypeScript JavaScript";
    const roleQueries = [title, "Frontend Developer", "Frontend Engineer", "React Developer", "Next.js Developer"].filter((value, index, values) => value && values.indexOf(value) === index).slice(0, 5);
    const queries = [
      ...roleQueries.map((role) => `site:linkedin.com/posts "${role}" hiring "${location}"`),
      `site:linkedin.com/posts "we're hiring" "${tech}" "${location}"`,
      `site:linkedin.com/posts "we are hiring" "${tech}" "${location}"`,
      `site:linkedin.com/posts "my team is hiring" "${tech}" "${location}"`,
      `site:linkedin.com/posts "send your resume" "${tech}" "${location}"`,
      `site:linkedin.com/posts "share your CV" "${tech}" "${location}"`,
      company ? `site:linkedin.com/posts "${company}" hiring "${tech}"` : `site:linkedin.com/posts hiring "${tech}" India`
    ].slice(0, MAX_QUERIES);

    const contacts = new Map<string, RecruiterContactCandidate>();
    const seenPosts = new Set<string>();
    const sourceStats: Record<string, SourceStat> = {};
    let queriesExecuted = 0;
    let rejected = 0;
    let uniqueUrls = 0;

    outer: for (const query of queries) {
      if (combinedSignal.aborted || contacts.size >= MAX_CONTACTS) break;
      queriesExecuted++;
      for (const source of sourceList(query)) {
        if (combinedSignal.aborted || contacts.size >= MAX_CONTACTS) break outer;
        const stat = sourceStats[source.id] ?? (sourceStats[source.id] = { attempted: 0, succeeded: 0, empty: 0, timeouts: 0, http403: 0, http429: 0, http5xx: 0, otherHttpErrors: 0, parseablePages: 0, usefulPages: 0, candidates: 0, duplicateCandidates: 0 });
        stat.attempted++;
        const result = await fetchText(source.url, combinedSignal);
        if (!result) { stat.timeouts++; stat.lastError = "NETWORK_OR_TIMEOUT"; continue; }
        if (result.status < 200 || result.status >= 300) {
          if (result.status === 403) stat.http403++; else if (result.status === 429) stat.http429++; else if (result.status >= 500) stat.http5xx++; else stat.otherHttpErrors++;
          stat.lastError = `HTTP_${result.status}`;
          continue;
        }
        if (!result.text.trim()) { stat.empty++; continue; }
        stat.succeeded++;
        stat.parseablePages++;
        const urls = extractUrls(result.text).slice(0, MAX_RESULTS_PER_SOURCE);
        for (const postUrl of urls) {
          if (seenPosts.has(postUrl)) continue;
          seenPosts.add(postUrl);
          uniqueUrls++;
          const index = result.text.indexOf(postUrl);
          const context = index >= 0 ? result.text.slice(Math.max(0, index - 1800), Math.min(result.text.length, index + 4200)) : result.text.slice(0, 6000);
          const candidate = candidateFromText(context, postUrl, input);
          if (!candidate) { rejected++; continue; }
          stat.usefulPages++;
          const key = candidate.linkedinProfileUrl?.toLowerCase() || candidate.email.toLowerCase() || `${candidate.fullName?.toLowerCase() ?? ""}|${candidate.companyDomain ?? ""}|${postUrl}`;
          const existing = contacts.get(key);
          if (existing) {
            stat.duplicateCandidates++;
            if ((candidate.confidence ?? 0) > (existing.confidence ?? 0)) contacts.set(key, candidate);
          } else {
            contacts.set(key, candidate);
            stat.candidates++;
          }
        }
      }
    }

    return {
      provider: this.name,
      contacts: [...contacts.values()].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)).slice(0, MAX_CONTACTS),
      discoveredAt: new Date(),
      metrics: freshMetrics(sourceStats, queries.length, queriesExecuted, contacts.size, uniqueUrls, rejected)
    };
  }

  async discoverEmails(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const result = await this.discover(input);
    return { ...result, contacts: result.contacts.filter((contact) => Boolean(contact.email)) };
  }

  verify(email: string): Promise<RecruiterVerificationResult> {
    return this.verifier.verify(email);
  }
}
