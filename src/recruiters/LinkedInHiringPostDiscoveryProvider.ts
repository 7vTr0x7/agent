import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult,
} from "./RecruiterDiscovery";
import { PublicRecruiterSearchProvider } from "./PublicRecruiterSearchProvider";
import { sourceList, type SourceId } from "./PublicSearchProviderRegistry";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const POST_URL = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/(?:posts\/[^\s<>"')]+|feed\/update\/urn:li:activity:\d+)/gi;
const PROFILE_URL = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const HIRING = /(?:we['’]?re\s+hiring|we\s+are\s+hiring|i['’]?m\s+hiring|i\s+am\s+hiring|my\s+team\s+is\s+hiring|our\s+team\s+is\s+hiring|we['’]?re\s+looking\s+for|we\s+are\s+looking\s+for|hiring\s*[:\-–—]|open\s+(?:role|roles|position|positions)|send\s+(?:your|me\s+your)\s+(?:resume|cv)|share\s+(?:your|an\s+updated)\s+(?:resume|cv)|dm\s+(?:me|us)|reach\s+out|apply\s+(?:here|now)|referrals?\s+welcome)/i;
const RECRUITER_ROLE = /recruiter|recruiting|talent acquisition|talent partner|talent sourcer|technical sourcer|hiring manager|human resources|\bhr\b|staffing|people operations|people ops|founder|co-founder|cofounder|hiring lead|engineering manager/i;
const NON_RECRUITING = /customer support|technical support|sales(?: executive| manager| representative)?|billing|privacy|legal|security|press|media|partnerships?|helpdesk|procurement|accounting|finance|customer success|marketing/i;
const BLOCKED_LOCAL_PART = /^(?:support|info|admin|press|media|legal|privacy|marketing|sales|hello|contact|help|feedback|abuse|postmaster|webmaster|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|automation|automated|bot|machine|system)$/i;
const GENERIC_EMAIL_DOMAINS = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com"]);
const ROLE_PATTERNS: Array<[string, RegExp]> = [
  ["Frontend Engineer", /frontend\s+engineer|front-end\s+engineer/i],
  ["Frontend Developer", /frontend\s+developer|front-end\s+developer/i],
  ["React Developer", /react(?:\.js)?\s+developer|developer\s*[-|/]\s*react(?:\.js)?/i],
  ["React Engineer", /react(?:\.js)?\s+engineer/i],
  ["Next.js Developer", /next\.?js\s+developer/i],
  ["JavaScript Developer", /javascript\s+developer/i],
  ["TypeScript Developer", /typescript\s+developer/i],
  ["Software Engineer — Frontend", /software\s+engineer.{0,70}(?:frontend|front-end)|(?:frontend|front-end).{0,70}software\s+engineer/i],
  ["Full Stack Developer — React", /full[ -]?stack\s+developer.{0,90}react|react.{0,90}full[ -]?stack\s+developer/i],
  ["Full Stack Engineer — React", /full[ -]?stack\s+engineer.{0,90}react|react.{0,90}full[ -]?stack\s+engineer/i],
  ["Web Developer", /web\s+developer/i],
];
const SKILLS = ["React", "React.js", "Next.js", "TypeScript", "JavaScript", "Node.js", "Express.js", "MongoDB", "REST APIs", "GraphQL", "Redux", "Redux Toolkit", "Tailwind CSS", "HTML", "CSS", "Jest", "Playwright", "Docker", "Git/GitHub"];

function clean(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#64;|&#x40;/gi, "@")
    .replace(/&#46;|&#x2e;/gi, ".")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function canonical(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingId", "refId", "lipi"].forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function plausibleName(value: string): boolean {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 5 || name.length > 80) return false;
  if (/^(the|we|our|my|team|hiring|frontend|react|software|developer|engineer|post|linkedin|job|role)\b/i.test(name)) return false;
  const parts = name.split(" ");
  return parts.length >= 2 && parts.length <= 5 && parts.every((part) => /^[A-Z][A-Za-z.'-]+$/.test(part));
}

function extractName(text: string): string | undefined {
  const patterns = [
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})['’]s\s+Post\b/i,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:posted|shared)\b/i,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:[12]\d{0,2}d|[1-9]\d?d|[1-9]\d?w|[1-9]\d?mo)\b/i,
    /\b(?:DM|contact|reach\s+out\s+to)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern)?.[1]?.trim();
    if (match && plausibleName(match)) return match;
  }
  return undefined;
}

function extractRole(text: string, fallback: string): { role: string; terms: string[]; score: number } {
  const terms: string[] = [];
  let score = 0;
  for (const [label, pattern] of ROLE_PATTERNS) {
    if (pattern.test(text)) {
      terms.push(label);
      score = Math.max(score, 75);
    }
  }
  const hits = SKILLS.filter((skill) => text.toLowerCase().includes(skill.toLowerCase())).length;
  score = Math.min(100, score + Math.min(25, hits * 4));
  return { role: terms[0] ?? fallback, terms: terms.length ? terms : [fallback], score };
}

function extractSkills(text: string): string[] {
  const lower = text.toLowerCase();
  return [...new Set(SKILLS.filter((skill) => lower.includes(skill.toLowerCase())))].slice(0, 12);
}

function extractLocation(text: string): string | undefined {
  return text.match(/(?:📍|location|based in|work location)\s*[:\-]?\s*([^|.;]{2,80})/i)?.[1]?.trim();
}

function extractExperience(text: string): string | undefined {
  return text.match(/(?:experience|exp)\s*[:\-]?\s*(\d+\s*(?:-|to|–|—)\s*\d+\s*years?|\d+\+?\s*years?)/i)?.[1]?.trim();
}

function experienceCompatible(text: string, candidateYears = 3): boolean {
  for (const match of text.matchAll(/(\d+)\s*(?:-|to|–|—)\s*(\d+)\s*years?/gi)) {
    if (candidateYears < Number(match[1]) || candidateYears > Number(match[2])) return false;
  }
  for (const match of text.matchAll(/(?:\b|\D)(\d+)\s*\+\s*years?/gi)) {
    if (candidateYears < Number(match[1])) return false;
  }
  return true;
}

function recruitingEmailEvidence(text: string, email: string): boolean {
  const normalized = clean(text);
  const index = normalized.toLowerCase().indexOf(email.toLowerCase());
  if (index < 0) return false;
  const context = normalized.slice(Math.max(0, index - 500), Math.min(normalized.length, index + 500));
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (BLOCKED_LOCAL_PART.test(local) || /(?:^|[-_.])(machine|bot|system|automation|automated|donotreply)(?:[-_.]|$)/i.test(local)) return false;
  if (NON_RECRUITING.test(context) && !RECRUITER_ROLE.test(context)) return false;
  return /(?:send|email|contact|reach\s+out|resume|cv|apply|hiring|recruiting|recruiter|talent|job|join\s+(?:our|my)\s+team|dm)/i.test(context);
}

function extractEmail(text: string): string | undefined {
  const values = [...new Set((clean(text).match(EMAIL) ?? []).map((email) => email.toLowerCase()))];
  return values.find((email) => {
    const domain = email.split("@")[1]?.toLowerCase();
    return Boolean(domain && !GENERIC_EMAIL_DOMAINS.has(domain) && recruitingEmailEvidence(text, email));
  });
}

function extractEmployer(text: string, email?: string, configuredCompany?: string, configuredDomain?: string): { name?: string; domain?: string } {
  const normalized = clean(text);
  const emailDomain = email?.split("@")[1]?.toLowerCase();
  const configured = configuredCompany?.trim() ?? "";
  const configuredDomainNormalized = configuredDomain?.trim().toLowerCase().replace(/^www\./, "") ?? "";
  const atCompany = normalized.match(/\bat\s+([A-Z][A-Za-z0-9&.' -]{2,90})(?=\s*[.!?,]|\s+(?:location|experience|skills?)\s*:|$)/i)?.[1]?.trim();
  const hiringCompany = normalized.match(/([A-Z][A-Za-z0-9&.' -]{2,90})\s+(?:is|are)\s+(?:hiring|looking\s+for)/i)?.[1]?.trim();
  const companyLabel = normalized.match(/(?:company|employer|organization|organisation)\s*[:=-]\s*([A-Z][A-Za-z0-9&.' -]{2,90})/i)?.[1]?.trim();
  const urlDomains = [...normalized.matchAll(/https?:\/\/([^\s/<>'"]+)/gi)]
    .map((match) => match[1]?.toLowerCase().replace(/^www\./, ""))
    .filter((domain): domain is string => Boolean(domain && !domain.endsWith("linkedin.com")));
  const domain = emailDomain ?? (configuredDomainNormalized || urlDomains.find((candidate) => candidate !== "lnkd.in"));
  const name = atCompany || hiringCompany || companyLabel || configured || (domain ? domain.split(".")[0]?.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) : undefined);
  return name ? { name: name.replace(/[|•,.-]+$/, "").trim(), domain } : {};
}

function extractProfile(text: string, name?: string): string | undefined {
  const urls = [...new Set((text.match(PROFILE_URL) ?? []).map(canonical))];
  if (!name) return urls[0];
  const tokens = name.toLowerCase().split(/\s+/).filter(Boolean).map((token) => token.replace(/[^a-z0-9-]/g, ""));
  return urls.find((url) => tokens.length >= 2 && tokens.every((token) => url.toLowerCase().includes(token)));
}

function evidenceWindow(text: string, url: string): string {
  const index = text.toLowerCase().indexOf(url.toLowerCase());
  return clean(index >= 0 ? text.slice(Math.max(0, index - 1800), Math.min(text.length, index + 4200)) : text).slice(0, 6500);
}

function freshness(text: string): "current" | "recent" | "historical" | "unknown" {
  if (/\b(?:today|1d|2d|3d|4d|5d|6d|1w|2w|3w|4w|1mo|2mo|3mo|4mo)\b/i.test(text)) return "current";
  if (/\b(?:5mo|6mo|7mo|8mo|9mo|10mo|11mo|12mo)\b/i.test(text)) return "recent";
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  const currentYear = new Date().getFullYear();
  if (years.includes(currentYear)) return "current";
  if (years.includes(currentYear - 1)) return "recent";
  if (years.some((year) => year < currentYear - 1)) return "historical";
  return "unknown";
}

function queryVariants(input: RecruiterDiscoveryInput): string[] {
  const location = input.location?.trim() || "India";
  const title = input.jobTitle.trim();
  const company = input.companyName.trim();
  const skills = extractSkills(input.jobDescription).slice(0, 4);
  const skillQuery = skills.length ? skills.join(" ") : "React Next.js TypeScript JavaScript";
  return [...new Set([
    `site:linkedin.com/posts "we're hiring" "${title}" "${location}"`,
    `site:linkedin.com/posts "we are hiring" "${title}" "${location}"`,
    `site:linkedin.com/posts "my team is hiring" ${skillQuery} "${location}"`,
    `site:linkedin.com/posts "send your resume" ${skillQuery} "${location}"`,
    `site:linkedin.com/posts "share your CV" ${skillQuery} "${location}"`,
    `site:linkedin.com/posts "DM me" ${skillQuery} "${location}" recruiter`,
    `site:linkedin.com/posts "${company}" hiring ${skillQuery}`,
    `site:linkedin.com/posts "${title}" recruiter "${location}"`,
    `site:linkedin.com/posts "${title}" "Bengaluru" React`,
    `site:linkedin.com/posts "${title}" "Pune" React`,
    `site:linkedin.com/in "${company}" recruiter "${location}"`,
    `site:linkedin.com/in "${company}" "talent acquisition" "${location}"`,
    `site:linkedin.com/in recruiter "${title}" "${location}"`,
  ])].slice(0, 16);
}

async function fetchSearchSource(url: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "text/plain,text/html,application/json,*/*;q=0.8", "user-agent": "job-agent-linkedin-public-hiring-evidence/1.0", ...(headers ?? {}) },
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function search(query: string, signal?: AbortSignal): Promise<Array<{ source: SourceId; text: string }>> {
  const sources = sourceList(query);
  const results: Array<{ source: SourceId; text: string }> = [];
  for (let offset = 0; offset < sources.length; offset += 4) {
    if (signal?.aborted) break;
    const batch = sources.slice(offset, offset + 4);
    const pages = await Promise.all(batch.map(async (source) => ({ source: source.id, text: await fetchSearchSource(source.url, signal, source.headers) })));
    for (const page of pages) if (page.text) results.push({ source: page.source, text: page.text });
  }
  return results;
}

export class LinkedInHiringPostDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "linkedin-hiring-posts";
  private readonly verifier = new PublicRecruiterSearchProvider();

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const runtimeSignal = AbortSignal.timeout(Number(process.env.LINKEDIN_HIRING_POST_TIMEOUT_MS ?? 60_000));
    const maxQueries = Math.max(1, Math.min(Number(process.env.LINKEDIN_HIRING_POST_MAX_QUERIES ?? 10), 16));
    const queries = queryVariants(input).slice(0, maxQueries);
    const contacts = new Map<string, RecruiterContactCandidate>();
    const seenPosts = new Set<string>();
    let queriesExecuted = 0;
    let rawPages = 0;
    let uniqueUrls = 0;
    let linkedinUrls = 0;
    let rejectedCandidates = 0;
    let duplicateCandidates = 0;
    const sourceStats: Record<string, { attempted: number; succeeded: number; empty: number; errors: number; posts: number }> = {};

    for (const query of queries) {
      if (runtimeSignal.aborted) break;
      queriesExecuted++;
      const results = await search(query, runtimeSignal);
      for (const result of results) {
        if (runtimeSignal.aborted) break;
        rawPages++;
        const stat = sourceStats[result.source] ?? (sourceStats[result.source] = { attempted: 0, succeeded: 0, empty: 0, errors: 0, posts: 0 });
        stat.attempted++;
        stat.succeeded++;
        const urls = [...new Set((result.text.match(POST_URL) ?? []).map(canonical))];
        linkedinUrls += urls.length;
        stat.posts += urls.length;
        uniqueUrls += urls.length;
        for (const postUrl of urls) {
          if (runtimeSignal.aborted) break;
          if (seenPosts.has(postUrl)) { duplicateCandidates++; continue; }
          seenPosts.add(postUrl);
          const context = evidenceWindow(result.text, postUrl);
          if (!HIRING.test(context) || !ROLE_PATTERNS.some(([, pattern]) => pattern.test(context))) { rejectedCandidates++; continue; }
          if (!experienceCompatible(context, Number(process.env.CANDIDATE_YEARS ?? 3))) { rejectedCandidates++; continue; }
          const role = extractRole(context, input.jobTitle);
          const email = extractEmail(context);
          const name = extractName(context);
          const profileUrl = extractProfile(context, name);
          const employer = extractEmployer(context, email, input.companyName, input.companyDomain);
          const recruiterEvidence = RECRUITER_ROLE.test(context) || /(?:my team|our team|i['’]?m hiring|i am hiring|join (?:our|my) team|send (?:your|me your) resume|reach out to me|apply here|apply now|dm me)/i.test(context);
          if (!recruiterEvidence && !email) { rejectedCandidates++; continue; }
          if (NON_RECRUITING.test(context) && !RECRUITER_ROLE.test(context) && !email) { rejectedCandidates++; continue; }
          const fresh = freshness(context);
          if (fresh === "unknown" || fresh === "historical") { rejectedCandidates++; continue; }
          if (!employer.name) { rejectedCandidates++; continue; }
          const domain = employer.domain?.toLowerCase();
          if (email && domain && email.split("@")[1]?.toLowerCase() !== domain) { rejectedCandidates++; continue; }
          if (!name && !email) { rejectedCandidates++; continue; }
          const score = Math.min(100, 55 + Math.min(20, extractSkills(context).length * 3) + (name ? 10 : 0) + (email ? 15 : 0) + (profileUrl ? 5 : 0));
          const candidate: RecruiterContactCandidate = {
            email: email ?? "",
            fullName: name ?? (email ? "Employer recruiting contact" : undefined),
            title: RECRUITER_ROLE.test(context) ? "Recruiter / Hiring Contact" : "Hiring Contact",
            department: "Recruiting",
            confidence: score / 100,
            verified: false,
            verificationStatus: email ? "public_hiring_post_unverified" : "public_hiring_post_identity",
            provider: this.name,
            linkedinProfileUrl: profileUrl,
            companyDomain: domain,
            location: extractLocation(context) ?? input.location,
            recruitingContext: context.slice(0, 1200),
            discoveryEvidence: [
              `Public LinkedIn post URL: ${postUrl}`,
              `Hiring evidence: ${context.slice(0, 4200)}`,
              `Role: ${role.role}`,
              `Skills: ${extractSkills(context).join(", ")}`,
              extractExperience(context) ? `Experience: ${extractExperience(context)}` : "",
              email ? `Public recruiting contact: ${email}` : "",
            ].filter(Boolean),
            discoveredAt: new Date(),
            sources: [{ url: postUrl, type: "linkedin_hiring_post_search_evidence", confidence: score / 100 }],
          };
          const key = profileUrl?.toLowerCase() || email?.toLowerCase() || `${name?.toLowerCase() ?? ""}|${employer.name.toLowerCase()}`;
          const existing = contacts.get(key);
          if (existing) {
            duplicateCandidates++;
            if ((candidate.confidence ?? 0) > (existing.confidence ?? 0)) contacts.set(key, candidate);
          } else {
            contacts.set(key, candidate);
          }
        }
      }
    }

    return {
      provider: this.name,
      contacts: [...contacts.values()].slice(0, 24),
      discoveredAt: new Date(),
      metrics: {
        queriesGenerated: queries.length,
        queriesExecuted,
        rawPages,
        uniqueUrls,
        linkedinUrls,
        recruiterCandidates: contacts.size,
        duplicateCandidates,
        rejectedCandidates,
        sourceStats,
      },
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
