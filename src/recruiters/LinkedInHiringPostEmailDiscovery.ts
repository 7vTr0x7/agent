import type { ProactiveRecruiterDiscoveryCandidate } from "./ProactiveRecruiterDiscoveryService";
import { sourceList, type SourceId } from "./PublicSearchProviderRegistry";
import { isPlausibleMailboxAddress } from "./RecruiterMailboxVerification";

export interface LinkedInHiringPostInput {
  targetRoles: string[];
  skills: string[];
  yearsExperience: number;
  preferredLocations: string[];
  maxQueries?: number;
  signal?: AbortSignal;
  fetchText?: (url: string, signal?: AbortSignal, headers?: Record<string, string>) => Promise<string | null>;
}

export interface LinkedInHiringPostMetrics {
  queriesGenerated: number;
  queriesExecuted: number;
  searchPagesFetched: number;
  postUrlsFound: number;
  relevantPosts: number;
  directEmails: number;
  candidates: number;
  rejected: number;
}

export interface LinkedInHiringPostResult {
  candidates: ProactiveRecruiterDiscoveryCandidate[];
  metrics: LinkedInHiringPostMetrics;
}

const SEARCH_PROVIDERS = new Set<SourceId>([
  "google-jina",
  "bing-jina",
  "duckduckgo-jina",
  "startpage-jina",
  "ecosia-jina",
  "jina-search"
]);

const POST_URL = /https?:\\/\\/(?:www\\.|[a-z]{2}\\.)?linkedin\\.com\\/(?:posts\\/[^\\s<>"]+|feed\\/update\\/urn:li:activity:\\d+)/gi;
const PROFILE_URL = /https?:\\/\\/(?:www\\.|[a-z]{2}\\.)?linkedin\\.com\\/in\\/[a-z0-9-_%]+/gi;
const EMAIL = /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/gi;
const SEARCH_HOST = /^(?:www\\.)?(?:google|bing|qwant|startpage|duckduckgo|search\\.yahoo|search\\.brave|mojeek)\\.com$/i;
const AUTOMATED_LOCAL = /^(?:noreply|no-reply|donotreply|do-not-reply|mailer-daemon|mailer|notifications?|automated|bot)$/i;

const HIRING = /(?:we['’]?re\\s+hiring|we\\s+are\\s+hiring|my\\s+team\\s+is\\s+hiring|we['’]?re\\s+looking\\s+for|we\\s+are\\s+looking\\s+for|hiring\\s+(?:for\\s+)?(?:a\\s+)?(?:frontend|front-end|react|next\\.?js|mern|full[ -]?stack|web|software)|looking\\s+for\\s+(?:a\\s+)?(?:frontend|front-end|react|next\\.?js|mern|full[ -]?stack|web|software)|send\\s+(?:your|me\\s+your)\\s+(?:resume|cv)|share\\s+(?:your|the)\\s+(?:resume|cv)|drop\\s+(?:your|the)\\s+(?:resume|cv)|apply\\s+(?:here|now)|dm\\s+(?:me|us)|reach\\s+out)/i;

const FRONTEND = /\\b(?:frontend|front-end|front\\s+end|react(?:\\.js)?|next\\.?js|mern|full[ -]?stack|web\\s+developer|software\\s+developer|software\\s+engineer)\\b/i;
const REACT = /\\breact(?:\\.js)?\\b/i;
const NEXT = /\\bnext\\.?js\\b/i;
const TECH = /\\b(?:react(?:\\.js)?|next\\.?js|typescript|javascript|redux|context\\s+api|tailwind|bootstrap|html5?|css3?|node(?:\\.js)?|express(?:\\.js)?|mongodb|rest(?:ful)?\\s+api|graphql|jest|react\\s+testing\\s+library)\\b/gi;

function decode(value: string): string {
  let current = value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/\\\\u003A/gi, ":")
    .replace(/\\\\u002F/gi, "/")
    .replace(/\\\\u0026/gi, "&")
    .replace(/\\\\u003D/gi, "=")
    .replace(/\\\\\\//g, "/");
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch { break; }
  }
  return current;
}

function canonical(value: string): string {
  const decoded = decode(value).replace(/[),.;]+$/, "");
  try {
    const url = new URL(decoded);
    url.hash = "";
    return url.toString().replace(/\\/$/, "");
  } catch {
    return decoded.replace(/\\/$/, "");
  }
}

function isLinkedInPost(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase().endsWith("linkedin.com") &&
      (/^\\/posts\\//i.test(url.pathname) || /^\\/feed\\/update\\/urn:li:activity:\\d+/i.test(url.pathname));
  } catch { return false; }
}

function isLinkedInProfile(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase().endsWith("linkedin.com") && /^\\/in\\//i.test(url.pathname);
  } catch { return false; }
}

function extractLinkedInUrls(text: string): string[] {
  const decoded = decode(text);
  const matches = [
    ...(decoded.match(POST_URL) ?? []),
    ...(decoded.match(PROFILE_URL) ?? [])
  ];
  return [...new Set(matches.map(canonical).filter(url => isLinkedInPost(url) || isLinkedInProfile(url)))];
}

function extractEmails(text: string): string[] {
  return [...new Set((decode(text).match(EMAIL) ?? []).map(value => value.toLowerCase()))]
    .filter(isPlausibleMailboxAddress)
    .filter(value => !AUTOMATED_LOCAL.test(value.split("@")[0] ?? ""));
}

function experienceCompatible(text: string, years: number): boolean {
  const ranges = [...text.matchAll(/(\\d+)\\s*(?:-|to|–|—)\\s*(\\d+)\\s*years?/gi)].map(m => [Number(m[1]), Number(m[2])] as const);
  const minimums = [...text.matchAll(/(\\d+)\\s*\\+\\s*years?/gi)].map(m => Number(m[1]));
  if (!ranges.length && !minimums.length) return true;
  return ranges.some(([min, max]) => years >= min && years <= max) || minimums.some(min => years >= min);
}

function locationCompatible(text: string, preferred: string[]): boolean {
  const haystack = text.toLowerCase();
  if (!preferred.length) return true;
  if (/\\bremote\\b/i.test(haystack) && preferred.some(value => /remote|india/i.test(value))) return true;
  return preferred.some(value => haystack.includes(value.toLowerCase()));
}

function roleScore(text: string, roles: string[], skills: string[]): { score: number; terms: string[] } {
  const haystack = text.toLowerCase();
  const terms = new Set<string>();
  let score = 0;
  if (FRONTEND.test(haystack)) score += 45;
  if (REACT.test(haystack)) { score += 20; terms.add("React"); }
  if (NEXT.test(haystack)) { score += 15; terms.add("Next.js"); }
  const skillHits = new Set((haystack.match(TECH) ?? []).map(value => value.toLowerCase())).size;
  score += Math.min(20, skillHits * 3);
  for (const role of roles) {
    const normalized = role.toLowerCase().replace(/[.]/g, "");
    if (normalized.includes("react") && REACT.test(haystack)) score += 8;
    if (normalized.includes("next") && NEXT.test(haystack)) score += 8;
    if (normalized.includes("frontend") && FRONTEND.test(haystack)) score += 8;
    if (normalized.includes("full stack") && /full[ -]?stack|mern/i.test(haystack)) score += 8;
  }
  for (const skill of skills) {
    if (skill.trim() && haystack.includes(skill.toLowerCase())) terms.add(skill);
  }
  return { score: Math.min(100, score), terms: [...terms].slice(0, 10) };
}

function emailIsRecruiting(text: string, email: string): boolean {
  const normalized = decode(text).toLowerCase();
  const index = normalized.indexOf(email.toLowerCase());
  if (index < 0) return false;
  const context = normalized.slice(Math.max(0, index - 700), Math.min(normalized.length, index + 700));
  return HIRING.test(context) || /(?:resume|cv|application|apply|hiring|recruiting|talent|job|role|opportunity)/i.test(context);
}

function extractEmployer(text: string, email: string): { name: string; domain: string } {
  const domain = email.split("@")[1]!.toLowerCase();
  const patterns = [
    /\\b(?:at|@)\\s+([A-Z][A-Za-z0-9&.' -]{2,80}?)(?=\\s+(?:is|are|hiring|looking|for|with|in|on)|[.!?]|$)/i,
    /([A-Z][A-Za-z0-9&.' -]{2,80})\\s+(?:is|are)\\s+(?:hiring|looking\\s+for)/i,
    /(?:company|employer|organization|organisation)\\s*[:=-]\\s*([A-Z][A-Za-z0-9&.' -]{2,80})/i
  ];
  for (const pattern of patterns) {
    const match = decode(text).match(pattern)?.[1]?.trim();
    if (match && !/^(the|we|our|my|team|frontend|react|software|developer|engineer)$/i.test(match)) return { name: match.replace(/[|•,.-]+$/, "").trim(), domain };
  }
  const name = domain.split(".")[0]!.replace(/[-_]+/g, " ").replace(/\\b\\w/g, c => c.toUpperCase());
  return { name, domain };
}

function evidenceAround(text: string, url: string): string {
  const decoded = decode(text);
  const needle = url.toLowerCase();
  const index = decoded.toLowerCase().indexOf(needle);
  if (index < 0) return decoded.slice(0, 9000);
  return decoded.slice(Math.max(0, index - 1800), Math.min(decoded.length, index + 7000));
}

async function fetchDefault(url: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "text/html,text/plain,*/*;q=0.8", "user-agent": "Mozilla/5.0 (compatible; job-agent-linkedin-hiring-posts/1.0)", ...headers }
    });
    return response.ok ? await response.text() : null;
  } catch { return null; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
}

export class LinkedInHiringPostEmailDiscovery {
  async discover(input: LinkedInHiringPostInput): Promise<LinkedInHiringPostResult> {
    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 4, 8));
    const role = input.targetRoles.slice(0, 3).join('" OR "') || "Frontend Developer";
    const skillQuery = input.skills.filter(Boolean).slice(0, 4).join('" OR "');
    const locations = input.preferredLocations.filter(Boolean).slice(0, 4).join('" OR "');
    const queries = [
      `site:linkedin.com/posts ("we're hiring" OR "we are hiring" OR "looking for") ("${role}") ("${skillQuery}") ("${locations}")`,
      `site:linkedin.com/posts hiring ("${role}") ("${skillQuery}") ("${locations}")`,
      `site:linkedin.com/posts ("send your resume" OR "share your CV" OR "drop your resume") (React OR Next.js OR MERN) ("${locations}")`,
      `site:linkedin.com/posts ("Frontend Developer" OR "React Developer" OR "MERN Stack") (hiring OR opportunity) India`
    ].slice(0, maxQueries);
    const metrics: LinkedInHiringPostMetrics = { queriesGenerated: queries.length, queriesExecuted: 0, searchPagesFetched: 0, postUrlsFound: 0, relevantPosts: 0, directEmails: 0, candidates: 0, rejected: 0 };
    const candidates = new Map<string, ProactiveRecruiterDiscoveryCandidate>();
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);

    for (const query of queries) {
      if (signal.aborted) break;
      metrics.queriesExecuted++;
      for (const source of sourceList(query).filter(item => SEARCH_PROVIDERS.has(item.id))) {
        if (signal.aborted) break;
        const text = await (input.fetchText ? input.fetchText(source.url, signal, source.headers) : fetchDefault(source.url, signal, source.headers));
        if (!text) continue;
        metrics.searchPagesFetched++;
        const urls = extractLinkedInUrls(text);
        for (const url of urls) {
          const evidence = evidenceAround(text, url);
          const page = await (input.fetchText ? input.fetchText(url, signal) : fetchDefault(url, signal));
          const combined = decode(`${evidence} ${page ?? ""}`);
          if (!HIRING.test(combined)) continue;
          const score = roleScore(combined, input.targetRoles, input.skills);
          if (score.score < 65 || !experienceCompatible(combined, input.yearsExperience) || !locationCompatible(combined, input.preferredLocations)) {
            metrics.rejected++;
            continue;
          }
          const email = extractEmails(combined).find(value => emailIsRecruiting(combined, value));
          if (!email) { metrics.rejected++; continue; }
          metrics.relevantPosts++;
          metrics.directEmails++;
          const employer = extractEmployer(combined, email);
          const candidate: ProactiveRecruiterDiscoveryCandidate = {
            contactType: "EMPLOYER",
            recruiterName: "LinkedIn hiring contact",
            recruiterRole: "Hiring contact",
            employer: employer.name,
            employerDomain: employer.domain,
            targetRoles: score.terms.length ? score.terms : input.targetRoles.slice(0, 3),
            roleMatchScore: score.score,
            hiringEvidenceScore: 95,
            overallConfidence: Math.min(100, score.score + 20),
            discoverySource: "public-web",
            discoveryUrl: url,
            discoveryEvidence: [combined.slice(0, 8000)],
            evidenceType: "job_hiring_evidence",
            evidenceDate: new Date().toISOString(),
            evidenceFreshness: /\\b(?:today|1d|2d|3d|4d|5d|6d|1w)\\b/i.test(combined) ? "current" : "recent",
            email,
            emailStatus: "UNVERIFIED",
            verificationEvidence: [{
              provider: "linkedin-public-post",
              status: "public-email",
              confidence: 95,
              mailboxLevel: false,
              source: url
            }]
          };
          candidates.set(`${email.toLowerCase()}|${url.toLowerCase()}`, candidate);
        }
      }
    }
    metrics.postUrlsFound = candidates.size;
    metrics.candidates = candidates.size;
    return { candidates: [...candidates.values()], metrics };
  }
}
