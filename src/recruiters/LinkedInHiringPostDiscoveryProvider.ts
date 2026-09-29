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
const JOB_DESCRIPTION = /(?:job\s+description|responsibilities|qualifications|required\s+(?:skills|experience)|key\s+(?:skills|requirements)|must\s+have|what\s+(?:you['’]?ll\s+work\s+on|we['’]?re\s+looking\s+for)|employment\s+type|job\s+type|apply\s+(?:here|now))/i;
const RECRUITER = /recruiter|recruiting|talent acquisition|talent partner|talent sourcer|technical sourcer|hiring manager|human resources|\bhr\b|staffing|people operations|people ops|founder|co-founder|cofounder|hiring lead|engineering manager/i;
const NON_RECRUITING = /customer support|technical support|sales(?: executive| manager| representative)?|billing|privacy|legal|security|press|media|partnerships?|helpdesk|procurement|accounting|finance|customer success|marketing/i;
const BLOCKED_LOCAL = /^(?:support|admin|press|media|legal|privacy|marketing|sales|hello|contact|help|feedback|abuse|postmaster|webmaster|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|automation|automated|bot|machine|system)$/i;
const GENERIC_RECRUITING_MAILBOXES = new Set(["hr", "careers", "career", "jobs", "job", "recruitment", "recruiting", "talent", "hiring", "apply", "joinus", "join-us", "workwithus", "work-with-us", "info"]);
const GENERIC_DOMAINS = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com"]);
const FRONTEND_EVIDENCE = [
  /\breact(?:\.js)?\b/i, /\bnext\.?js\b/i, /\breact\s+native\b/i, /\btypescript\b/i, /\bjavascript\b/i,
  /\bhtml(?:5)?\b/i, /\bcss(?:3)?\b/i, /\bresponsive\b/i, /\b(?:redux|context\s*api|zustand|mobx|state\s+management)\b/i,
  /\b(?:rest\s*api|restful\s*api|api\s+integration|graphql)\b/i, /\b(?:hooks|component\s+architecture|component\s+library|design\s+system|ui\s+components?)\b/i,
  /\b(?:frontend|front-end|front\s+end|user-facing|web\s+application|web\s+app|dashboard|product\s+interface)\b/i,
  /\b(?:jest|react\s+testing\s+library|playwright|cypress)\b/i, /\b(?:web\s+performance|core\s+web\s+vitals|browser\s+rendering)\b/i,
];
const BACKEND_EVIDENCE = [/\bnode(?:\.js)?\b/i, /\bexpress(?:\.js)?\b/i, /\bnest(?:\.js)?\b/i, /\bfastify\b/i, /\bmongodb\b/i, /\b(?:sql|postgres(?:ql)?|mysql)\b/i, /\b(?:backend|back-end|server-side|api\s+development)\b/i];
const SKILLS = ["React", "React.js", "Next.js", "TypeScript", "JavaScript", "Node.js", "Express.js", "MongoDB", "REST APIs", "GraphQL", "Redux", "Redux Toolkit", "Tailwind CSS", "HTML", "CSS", "Jest", "Playwright", "Docker", "Git/GitHub"];

type PublicSearchResult = { source: SourceId; text: string };

function clean(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#64;|&#x40;/gi, "@").replace(/&#46;|&#x2e;/gi, ".").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
}
function canonical(value: string): string { try { const url = new URL(value); url.hash = ""; ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingId", "refId", "lipi"].forEach((key) => url.searchParams.delete(key)); return url.toString().replace(/\/$/, ""); } catch { return value.replace(/\/+$/, ""); } }
function plausibleName(value: string): boolean { const parts = value.trim().replace(/\s+/g, " ").split(" "); if (parts.length < 2 || parts.length > 5) return false; const name = parts.join(" "); return name.length >= 5 && name.length <= 80 && parts.every((part) => /^[A-Z][A-Za-z.'-]+$/.test(part)) && !/^(the|we|our|my|team|hiring|frontend|react|software|developer|engineer|post|linkedin|job|role)$/i.test(parts[0] ?? ""); }
function authorName(text: string): string | undefined { const patterns = [/\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})['’]s\s+Post\b/i,/\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:posted|shared)\b/i,/\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:[1-9]\d?d|[1-9]\d?w|[1-9]\d?mo)\b/i]; for (const pattern of patterns) { const value = text.match(pattern)?.[1]?.trim(); if (value && plausibleName(value)) return value; } return undefined; }
function roleInfo(text: string, fallback: string): { role: string; terms: string[]; score: number } {
  const frontendHits = FRONTEND_EVIDENCE.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  const backendHits = BACKEND_EVIDENCE.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  const react = /\breact(?:\.js)?\b/i.test(text); const next = /\bnext\.?js\b/i.test(text); const node = /\b(?:node(?:\.js)?|express(?:\.js)|nest(?:\.js)|fastify)\b/i.test(text);
  const web = /\b(?:web\s+application|web\s+app|responsive|user-facing|frontend|front-end|front\s+end|dashboard|product\s+interface)\b/i.test(text); const javascript = /\bjavascript\b/i.test(text); const typescript = /\btypescript\b/i.test(text); const api = /\b(?:rest\s*api|restful\s*api|graphql|api\s+integration)\b/i.test(text);
  const terms = [...new Set([...(react ? ["React", "Frontend"] : []), ...(next && react ? ["Next.js"] : []), ...(typescript ? ["TypeScript"] : []), ...(javascript ? ["JavaScript"] : []), ...(node ? ["Node.js"] : []), ...(api ? ["REST APIs"] : [])])];
  if (react && node && (api || backendHits >= 1)) return { role: "Full Stack Developer — React", terms, score: Math.min(100, 84 + Math.min(12, frontendHits + backendHits)) };
  if (react && (web || frontendHits >= 3)) return { role: "Frontend Developer", terms, score: Math.min(100, 84 + Math.min(12, frontendHits)) };
  if (next && web && (javascript || typescript)) return { role: "Next.js Developer", terms, score: Math.min(100, 82 + Math.min(14, frontendHits)) };
  if (web && react && javascript && frontendHits >= 3) return { role: "Web Developer", terms, score: Math.min(100, 80 + Math.min(15, frontendHits)) };
  return { role: fallback, terms: [], score: 0 };
}
function experienceCompatible(text: string, years: number): boolean {
  const ranges = [...text.matchAll(/(\d+)\s*(?:-|to|–|—)\s*(\d+)\s*years?/gi)].map((match) => [Number(match[1]), Number(match[2])] as const);
  const minimums = [...text.matchAll(/(?:\b|\D)(\d+)\s*\+\s*years?/gi)].map((match) => Number(match[1]));
  if (!ranges.length && !minimums.length) return true;
  return ranges.some(([min, max]) => years >= min && years <= max) || minimums.some((min) => years >= min);
}
function freshness(text: string): "current" | "recent" | "historical" | "unknown" { if (/\b(?:today|1d|2d|3d|4d|5d|6d|1w|2w|3w|4w|1mo|2mo|3mo|4mo)\b/i.test(text)) return "current"; if (/\b(?:5mo|6mo|7mo|8mo|9mo|10mo|11mo|12mo)\b/i.test(text)) return "recent"; const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1])); const current = new Date().getFullYear(); if (years.includes(current)) return "current"; if (years.includes(current - 1)) return "recent"; if (years.some((year) => year < current - 1)) return "historical"; return "unknown"; }
function recruitingEmail(text: string): string | undefined {
  const normalized = clean(text);
  const emailPattern = new RegExp(EMAIL.source, "gi");
  const found = [...new Set((normalized.match(emailPattern) ?? []).map((email) => email.toLowerCase()))];
  const ranked = [...found].sort((a, b) => {
    const aLocal = a.split("@")[0]?.toLowerCase() ?? ""; const bLocal = b.split("@")[0]?.toLowerCase() ?? "";
    return Number(GENERIC_RECRUITING_MAILBOXES.has(aLocal)) - Number(GENERIC_RECRUITING_MAILBOXES.has(bLocal));
  });
  return ranked.find((email) => {
    const [local, domain] = email.split("@"); if (!local || !domain || GENERIC_DOMAINS.has(domain) || BLOCKED_LOCAL.test(local)) return false;
    const index = normalized.toLowerCase().indexOf(email); const context = normalized.slice(Math.max(0, index - 650), Math.min(normalized.length, index + 650));
    if (NON_RECRUITING.test(context) && !RECRUITER.test(context)) return false;
    return /send|email|contact|reach\s+out|resume|cv|apply|hiring|recruiting|recruiter|talent|job|dm|drop/i.test(context);
  });
}
function employer(text: string, input: RecruiterDiscoveryInput, email?: string): { name?: string; domain?: string } { const normalized = clean(text); const emailDomain = email?.split("@")[1]?.toLowerCase(); const configuredDomain = input.companyDomain.trim().toLowerCase().replace(/^www\./, ""); const atCompany = normalized.match(/\bat\s+([A-Z][A-Za-z0-9&.' -]{2,90})(?=\s*[.!?,]|\s+(?:location|experience|skills?)\s*:|$)/i)?.[1]?.trim(); const hiringCompany = normalized.match(/([A-Z][A-Za-z0-9&.' -]{2,90})\s+(?:is|are)\s+(?:hiring|looking\s+for)/i)?.[1]?.trim(); const name = atCompany || hiringCompany || input.companyName.trim() || (emailDomain ? emailDomain.split(".")[0] : undefined); const domain = emailDomain ?? (configuredDomain || undefined); return name ? { name: name.replace(/[|•,.-]+$/, "").trim(), domain } : {}; }
function profileUrl(text: string, name?: string): string | undefined { const urls = [...new Set((text.match(PROFILE_URL) ?? []).map(canonical))]; if (!name) return urls[0]; const tokens = name.toLowerCase().split(/\s+/).map((token) => token.replace(/[^a-z0-9-]/g, "")); return urls.find((url) => tokens.length >= 2 && tokens.every((token) => url.toLowerCase().includes(token))); }
function evidence(text: string, postUrl: string): string { const index = text.toLowerCase().indexOf(postUrl.toLowerCase()); return clean(index >= 0 ? text.slice(Math.max(0, index - 1800), Math.min(text.length, index + 4200)) : text).slice(0, 6500); }
function extractPostUrls(text: string): string[] {
  POST_URL.lastIndex = 0;
  const matches = text.match(POST_URL) ?? [];
  POST_URL.lastIndex = 0;
  return [...new Set(matches.map(canonical))];
}
function queries(input: RecruiterDiscoveryInput): string[] { const location = input.location?.trim() || "India"; const title = input.jobTitle.trim(); const company = input.companyName.trim(); const skills = SKILLS.filter((skill) => input.jobDescription.toLowerCase().includes(skill.toLowerCase())).slice(0, 4).join(" ") || "React Next.js TypeScript JavaScript"; return [...new Set([`site:linkedin.com/posts "we're hiring" "${title}" "${location}"`,`site:linkedin.com/posts "we are hiring" "${title}" "${location}"`,`site:linkedin.com/posts "my team is hiring" ${skills} "${location}"`,`site:linkedin.com/posts "send your resume" ${skills} "${location}"`,`site:linkedin.com/posts "share your CV" ${skills} "${location}"`,`site:linkedin.com/posts "DM me" ${skills} "${location}" recruiter`,`site:linkedin.com/posts "${company}" hiring ${skills}`,`site:linkedin.com/posts "${title}" recruiter "${location}"`,`site:linkedin.com/posts "${title}" "Bengaluru" React`,`site:linkedin.com/posts "${title}" "Pune" React`,`site:linkedin.com/in "${company}" recruiter "${location}"`,`site:linkedin.com/in "${company}" "talent acquisition" "${location}"`,`site:linkedin.com/in recruiter "${title}" "${location}"`])].slice(0, 16); }
async function fetchSearch(url: string, signal: AbortSignal, headers?: Record<string, string>): Promise<string | null> { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000); const abort = () => controller.abort(); signal.addEventListener("abort", abort, { once: true }); try { const response = await fetch(url, { signal: controller.signal, headers: { accept: "text/plain,text/html,application/json,*/*;q=0.8", "user-agent": "job-agent-linkedin-public-hiring-evidence/1.0", ...(headers ?? {}) } }); return response.ok ? await response.text() : null; } catch { return null; } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); } }
async function search(query: string, signal: AbortSignal): Promise<PublicSearchResult[]> { const sources = sourceList(query); const results: PublicSearchResult[] = []; for (let offset = 0; offset < sources.length; offset += 4) { if (signal.aborted) break; const pages = await Promise.all(sources.slice(offset, offset + 4).map(async (source) => ({ source: source.id, text: await fetchSearch(source.url, signal, source.headers) }))); for (const page of pages) if (page.text) results.push({ source: page.source, text: page.text }); } return results; }

export class LinkedInHiringPostDiscoveryProvider implements RecruiterDiscoveryProvider {
  readonly name = "linkedin-hiring-posts";
  private readonly verifier = new PublicRecruiterSearchProvider();
  async discover(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> {
    const signal = AbortSignal.timeout(Number(process.env.LINKEDIN_HIRING_POST_TIMEOUT_MS ?? 60_000)); const maxQueries = Math.max(1, Math.min(Number(process.env.LINKEDIN_HIRING_POST_MAX_QUERIES ?? 10), 16)); const queryList = queries(input).slice(0, maxQueries); const contacts = new Map<string, RecruiterContactCandidate>(); const seenPosts = new Set<string>();
    let queriesExecuted = 0; let rawPages = 0; let uniqueUrls = 0; let linkedinUrls = 0; let duplicateCandidates = 0; let rejectedCandidates = 0;
    for (const query of queryList) {
      if (signal.aborted) break; queriesExecuted++;
      for (const result of await search(query, signal)) {
        if (signal.aborted) break; rawPages++;
        for (const postUrl of extractPostUrls(result.text)) {
          if (signal.aborted) break; uniqueUrls++; linkedinUrls++; if (seenPosts.has(postUrl)) { duplicateCandidates++; continue; } seenPosts.add(postUrl);
          const text = evidence(result.text, postUrl); const role = roleInfo(text, input.jobTitle); const years = Number(process.env.CANDIDATE_YEARS ?? 3); const technicalEvidence = FRONTEND_EVIDENCE.some((pattern) => pattern.test(text));
          if ((!HIRING.test(text) && !JOB_DESCRIPTION.test(text)) || !role.terms.length || role.score < 80 || !technicalEvidence || !experienceCompatible(text, years)) { rejectedCandidates++; continue; }
          const email = recruitingEmail(text); const name = authorName(text); const profile = profileUrl(text, name); const company = employer(text, input, email); const fresh = freshness(text);
          const explicitRecruiting = RECRUITER.test(text) || /(?:we['’]?re hiring|we are hiring|we['’]?re looking for|we are looking for|my team|our team|i['’]?m hiring|i am hiring|join (?:our|my) team|send (?:your|me your) resume|reach out to me|apply here|apply now|dm me|share (?:your|an updated) (?:resume|cv))/i.test(text);
          if (!company.name || fresh === "unknown" || fresh === "historical" || (!name && !email) || (!explicitRecruiting && !email)) { rejectedCandidates++; continue; }
          if (email && company.domain && email.split("@")[1]?.toLowerCase() !== company.domain.toLowerCase()) { rejectedCandidates++; continue; }
          const matchedSkills = SKILLS.filter((skill) => text.toLowerCase().includes(skill.toLowerCase())); const score = Math.min(100, 60 + Math.min(20, matchedSkills.length * 3) + (name ? 8 : 0) + (email ? 15 : 0) + (profile ? 5 : 0));
          const candidate: RecruiterContactCandidate = { email: email ?? "", fullName: name ?? (email ? "Employer recruiting contact" : undefined), title: RECRUITER.test(text) ? "Recruiter / Hiring Contact" : "Hiring Contact", department: "Recruiting", confidence: score / 100, verified: false, verificationStatus: email ? "public_hiring_post_unverified" : "public_hiring_post_identity", provider: this.name, linkedinProfileUrl: profile, companyDomain: company.domain, location: input.location, recruitingContext: text.slice(0, 1200), discoveryEvidence: [`Public LinkedIn post URL: ${postUrl}`, `Hiring evidence: ${text.slice(0, 4200)}`, `Role evidence: ${role.role}`, `Skills: ${matchedSkills.slice(0, 12).join(", ")}`, email ? `Public recruiting contact: ${email}` : ""].filter(Boolean), discoveredAt: new Date(), sources: [{ url: postUrl, type: "linkedin_hiring_post_search_evidence", confidence: score / 100 }] };
          const key = profile?.toLowerCase() || email?.toLowerCase() || `${name?.toLowerCase() ?? ""}|${company.name.toLowerCase()}`; const existing = contacts.get(key); if (existing) { duplicateCandidates++; if ((candidate.confidence ?? 0) > (existing.confidence ?? 0)) contacts.set(key, candidate); } else contacts.set(key, candidate);
        }
      }
    }
    return { provider: this.name, contacts: [...contacts.values()].slice(0, 24), discoveredAt: new Date(), metrics: { queriesGenerated: queryList.length, queriesExecuted, rawPages, uniqueUrls, linkedinUrls, recruiterCandidates: contacts.size, duplicateCandidates, rejectedCandidates } };
  }
  async discoverEmails(input: RecruiterDiscoveryInput): Promise<RecruiterDiscoveryResult> { const result = await this.discover(input); return { ...result, contacts: result.contacts.filter((contact) => Boolean(contact.email)) }; }
  verify(email: string): Promise<RecruiterVerificationResult> { return this.verifier.verify(email); }
}
