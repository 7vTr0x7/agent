import {
  RecruiterContactCandidate,
  RecruiterDiscoveryInput,
  RecruiterDiscoveryProvider,
  RecruiterDiscoveryResult,
  RecruiterVerificationResult,
} from "./RecruiterDiscovery";
import { PublicRecruiterSearchProvider } from "./PublicRecruiterSearchProvider";
import { sourceList, type SourceId } from "./PublicSearchProviderRegistry";

const POST_URL = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/(?:posts\/[^\s<>"')]+|feed\/update\/urn:li:activity:\d+)/gi;
const PROFILE_URL = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HIRING = /(?:we['’]?re\s+hiring|we\s+are\s+hiring|my\s+team\s+is\s+hiring|our\s+team\s+is\s+hiring|i['’]?m\s+hiring|we['’]?re\s+looking\s+for|we\s+are\s+looking\s+for|hiring\s*[:\-–—]|send\s+(?:your|me\s+your)\s+(?:resume|cv)|share\s+(?:your|an\s+updated)\s+(?:resume|cv)|dm\s+(?:me|us)|apply\s+(?:here|now)|referrals?\s+welcome)/i;
const RECRUITER = /recruiter|recruiting|talent acquisition|talent partner|talent sourcer|technical sourcer|hiring manager|human resources|\bhr\b|staffing|people operations|people ops|founder|co-founder|cofounder|hiring lead|engineering manager/i;
const NON_RECRUITING = /customer support|technical support|sales(?: executive| manager| representative)?|billing|privacy|legal|security|press|media|partnerships?|helpdesk|procurement|accounting|finance|customer success|marketing/i;
const BLOCKED_LOCAL = /^(?:support|info|admin|press|media|legal|privacy|marketing|sales|hello|contact|help|feedback|abuse|postmaster|webmaster|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|automation|automated|bot|machine|system)$/i;
const GENERIC_DOMAINS = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com"]);
const ROLES: Array<[string, RegExp]> = [
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

type PublicSearchResult = { source: SourceId; text: string };

function clean(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#64;|&#x40;/gi, "@").replace(/&#46;|&#x2e;/gi, ".").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
}

function canonical(value: string): string {
  try {
    const url = new URL(value); url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingId", "refId", "lipi"].forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch { return value.replace(/\/+$/, ""); }
}

function plausibleName(value: string): boolean {
  const parts = value.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length < 2 || parts.length > 5) return false;
  const name = parts.join(" ");
  return name.length >= 5 && name.length <= 80 && parts.every((part) => /^[A-Z][A-Za-z.'-]+$/.test(part)) && !/^(the|we|our|my|team|hiring|frontend|react|software|developer|engineer|post|linkedin|job|role)$/i.test(parts[0] ?? "");
}

function authorName(text: string): string | undefined {
  const patterns = [
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})['’]s\s+Post\b/i,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:posted|shared)\b/i,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:[1-9]\d?d|[1-9]\d?w|[1-9]\d?mo)\b/i,
  ];
  for (const pattern of patterns) { const value = text.match(pattern)?.[1]?.trim(); if (value && plausibleName(value)) return value; }
  return undefined;
}

function roleInfo(text: string, fallback: string): { role: string; terms: string[]; score: number } {
  const terms = ROLES.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  const skills = SKILLS.filter((skill) => text.toLowerCase().includes(skill.toLowerCase())).length;
  return { role: terms[0] ?? fallback, terms: terms.length ? terms : [fallback], score: Math.min(100, (terms.length ? 75 : 0) + Math.min(25, skills * 4)) };
}

function experienceCompatible(text: string, years: number): boolean {
  for (const match of text.matchAll(/(\d+)\s*(?:-|to|–|—)\s*(\d+)\s*years?/gi)) if (years < Number(match[1]) || years > Number(match[2])) return false;
  for (const match of text.matchAll(/(?:\b|\D)(\d+)\s*\+\s*years?/gi)) if (years < Number(match[1])) return false;
  return true;
}

function freshness(text: string): "current" | "recent" | "historical" | "unknown" {
  if (/\b(?:today|1d|2d|3d|4d|5d|6d|1w|2w|3w|4w|1mo|2mo|3mo|4mo)\b/i.test(text)) return "current";
  if (/\b(?:5mo|6mo|7mo|8mo|9mo|10mo|11mo|12mo)\b/i.test(text)) return "recent";
  const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1]));
  const current = new Date().getFullYear();
  if (years.includes(current)) return "current";
  if (years.includes(current - 1)) return "recent";
  if (years.some((year) => year < current - 1)) return "historical";
  return "unknown";
}

function recruitingEmail(text: string): string | undefined {
  const normalized = clean(text);
  return [...new Set((normalized.match(EMAIL) ?? []).map((email) => email.toLowerCase()))].find((email) => {
    const [local, domain] = email.split("@");
    if (!local || !domain || GENERIC_DOMAINS.has(domain) || BLOCKED_LOCAL.test(local)) return false;
    const index = normalized.toLowerCase().indexOf(email); const context = normalized.slice(Math.max(0, index - 500), Math.min(normalized.length, index + 500));
    if (NON_RECRUITING.test(context) && !RECRUITER.test(context)) return false;
    return /send|email|contact|reach\s+out|resume|cv|apply|hiring|recruiting|recruiter|talent|job|dm/i.test(context);
  });
}

function employer(text: string, input: RecruiterDiscoveryInput, email?: string): { name?: string; domain?: string } {
  const normalized = clean(text); const emailDomain = email?.split("@")[1]?.toLowerCase();
  const configuredDomain = input.companyDomain.trim().toLowerCase().replace(/^www\./, "");
  const atCompany = normalized.match(/\bat\s+([A-Z][A-Za-z0-9&.' -]{2,90})(?=\s*[.!?,]|\s+(?:location|experience|skills?)\s*:|$)/i)?.[1]?.trim();
  const hiringCompany = normalized.match(/([A-Z][A-Za-z0-9&.' -]{2,90})\s+(?:is|are)\s+(?:hiring|looking\s+for)/i)?.[1]?.trim();
  const name = atCompany || hiringCompany || input.companyName.trim() || (emailDomain ? emailDomain.split(".")[0] : undefined);
  const domain = emailDomain ?? (configuredDomain || undefined);
  return name ? { name: name.replace(/[|•,.-]+$/, "").trim(), domain } : {};
}

function profileUrl(text: string, name?: string): string | undefined {
  const urls = [...new Set((text.match(PROFILE_URL) ?? []).map(canonical))];
  if (!name) return urls[0];
  const tokens = name.toLowerCase().split(/\s+/).map((token) => token.replace(/[^a-z0-9-]/g, ""));
  return urls.find((url) => tokens.length >= 2 && tokens.every((token) => url.toLowerCase().includes(token)));
}

function evidence(text: string, postUrl: string): string {
  const index = text.toLowerCase().indexOf(postUrl.toLowerCase());
  return clean(index >= 0 ? text.slice(Math.max(0, index - 1800), Math.min(text.length, index + 4200)) : text).slice(0, 6500);
}

function queries(input: RecruiterDiscoveryInput): string[] {
  const location = input.location?.trim() || "India"; const title = input.jobTitle.trim(); const company = input.companyName.trim();
  const skills = SKILLS.filter((skill) => input.jobDescription.toLowerCase().includes(skill.toLowerCase())).slice(0, 4).join(" ") || "React Next.js TypeScript JavaScript";
  return [...new Set([
    `site:linkedin.com/posts "we're hiring" "${title}" "${location}"`,
    `site:linkedin.com/posts "we are hiring" "${title}" "${location}"`,
    `site:linkedin.com/posts "my team is hiring" ${skills} "${location}"`,
    `site:linkedin.com/posts "send your resume" ${skills} "${location}"`,
    `site:linkedin.com/posts "share your CV" ${skills} "${location}"`,
    `site:linkedin.com/posts "DM me" ${skills} "${location}" recruiter`,
    `site:linkedin.com/posts "${company}" hiring ${skills}`,
    `site:linkedin.com/posts "${title}" recruiter "${location}"`,
    `site:linkedin.com/posts "${title}" "Bengaluru" React`,
    `site:linkedin.com/posts "${title}" "Pune" React`,
    `site:linkedin.com/in "${company}" recruiter "${location}"`,
    `site:linkedin.com/in "${company}" "talent acquisition" "${location}"`,
    `site:linkedin.com/in recruiter "${title}" "${location}"`,
  ])].slice(0, 16);
}

async function fetchSearch(url: string, signal: AbortSignal, headers?: Record<string, string>): Promise<string | null> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000); const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true });
  try { const response = await fetch(url, { signal: controller.signal, headers: { accept: "text/plain,text/html,application/json,*/*;q=0.8", "user-agent": "job-agent-linkedin-public-hiring-evidence/1.0", ...(headers ?? {}) } }); return response.ok ? await response.text() : null; }
  catch { return null; } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}

async function search(query: string, signal: AbortSignal): Promise<PublicSearchResult[]> {
  const sources = sourceList(query); const results: PublicSearchResult[] = [];
  for (let offset = 0; offset < sources.length; offset += 4) {
    if (signal.aborted) break;
    const pages = await Promise.all(sources.slice(offset, offset + 4).map(async (source) => ({ source: source.id, text: await fetchSearch(source.url, signal, source.headers) })));
    for (const page of pages) if (page.text) results.push({ source: page.source, text: page.text });
  }
  return results;
}

export class LinkedInHiringPostDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "linkedin-hiring-posts";
  private readonly verifier = new PublicRecruiterSearchProvider();

  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const signal = AbortSignal.timeout(Number(process.env.LINKEDIN_HIRING_POST_TIMEOUT_MS ?? 60_000));
    const maxQueries = Math.max(1, Math.min(Number(process.env.LINKEDIN_HIRING_POST_MAX_QUERIES ?? 10), 16));
    const queryList = queries(input).slice(0, maxQueries); const contacts = new Map<string, RecruiterContactCandidate>(); const seenPosts = new Set<string>();
    let queriesExecuted = 0; let rawPages = 0; let uniqueUrls = 0; let linkedinUrls = 0; let duplicateCandidates = 0; let rejectedCandidates = 0;
    for (const query of queryList) {
      if (signal.aborted) break; queriesExecuted++;
      for (const result of await search(query, signal)) {
        if (signal.aborted) break; rawPages++;
        for (const postUrl of [...new Set((result.text.match(POST_URL) ?? []).map(canonical))]) {
          if (signal.aborted) break; uniqueUrls++; linkedinUrls++;
          if (seenPosts.has(postUrl)) { duplicateCandidates++; continue; } seenPosts.add(postUrl);
          const text = evidence(result.text, postUrl); const role = roleInfo(text, input.jobTitle); const years = Number(process.env.CANDIDATE_YEARS ?? 3);
          if (!HIRING.test(text) || role.score < 75 || !experienceCompatible(text, years)) { rejectedCandidates++; continue; }
          const email = recruitingEmail(text); const name = authorName(text); const profile = profileUrl(text, name); const company = employer(text, input, email); const fresh = freshness(text);
          const explicitRecruiting = RECRUITER.test(text) || /(?:my team|our team|i['’]?m hiring|i am hiring|join (?:our|my) team|send (?:your|me your) resume|reach out to me|apply here|apply now|dm me)/i.test(text);
          if (!company.name || fresh === "unknown" || fresh === "historical" || (!name && !email) || (!explicitRecruiting && !email)) { rejectedCandidates++; continue; }
          if (email && company.domain && email.split("@")[1]?.toLowerCase() !== company.domain.toLowerCase()) { rejectedCandidates++; continue; }
          const score = Math.min(100, 55 + Math.min(20, SKILLS.filter((skill) => text.toLowerCase().includes(skill.toLowerCase())).length * 3) + (name ? 10 : 0) + (email ? 15 : 0) + (profile ? 5 : 0));
          const candidate: RecruiterContactCandidate = {
            email: email ?? "", fullName: name ?? (email ? "Employer recruiting contact" : undefined), title: RECRUITER.test(text) ? "Recruiter / Hiring Contact" : "Hiring Contact", department: "Recruiting", confidence: score / 100,
            verified: false, verificationStatus: email ? "public_hiring_post_unverified" : "public_hiring_post_identity", provider: this.name, linkedinProfileUrl: profile, companyDomain: company.domain, location: input.location,
            recruitingContext: text.slice(0, 1200), discoveryEvidence: [`Public LinkedIn post URL: ${postUrl}`, `Hiring evidence: ${text.slice(0, 4200)}`, `Role: ${role.role}`, `Skills: ${SKILLS.filter((skill) => text.toLowerCase().includes(skill.toLowerCase())).slice(0, 12).join(", ")}`, email ? `Public recruiting contact: ${email}` : ""].filter(Boolean), discoveredAt: new Date(),
            sources: [{ url: postUrl, type: "linkedin_hiring_post_search_evidence", confidence: score / 100 }],
          };
          const key = profile?.toLowerCase() || email?.toLowerCase() || `${name?.toLowerCase() ?? ""}|${company.name.toLowerCase()}`; const existing = contacts.get(key);
          if (existing) { duplicateCandidates++; if ((candidate.confidence ?? 0) > (existing.confidence ?? 0)) contacts.set(key, candidate); } else contacts.set(key, candidate);
        }
      }
    }
    return { provider: this.name, contacts: [...contacts.values()].slice(0, 24), discoveredAt: new Date(), metrics: { queriesGenerated: queryList.length, queriesExecuted, rawPages, uniqueUrls, linkedinUrls, recruiterCandidates: contacts.size, duplicateCandidates, rejectedCandidates } };
  }

  async discoverEmails(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const result = await this.discover(input); return { ...result, contacts: result.contacts.filter((contact) => Boolean(contact.email)) };
  }

  verify(email: string): Promise<RecruiterVerificationResult> { return this.verifier.verify(email); }
}
