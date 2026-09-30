import type { ProactiveRecruiterDiscoveryCandidate } from "./ProactiveRecruiterDiscoveryService";
import { sourceList } from "./PublicSearchProviderRegistry";
import type { SourceId } from "./PublicSearchProviderRegistry";
import { isPlausibleMailboxAddress } from "./RecruiterMailboxVerification";

export interface PublicHiringPostDiscoveryMetrics {
  queriesGenerated: number;
  queriesExecuted: number;
  sourcePagesFetched: number;
  publicPostUrls: number;
  hiringIntentPosts: number;
  relevantRolePosts: number;
  employersExtracted: number;
  authorsExtracted: number;
  validatedIdentities: number;
  validatedContacts: number;
  directEmails: number;
  publiclyDiscoveredEmails: number;
  rejectedPosts: number;
  duplicatePosts: number;
  sourceStats: Record<string, { attempted: number; succeeded: number; empty: number; errors: number; posts: number }>;
  configuredProviders: number;
  eligibleProviders: number;
  executedProviders: number;
  skippedProviders: number;
  providerFailures: number;
  providerRateLimited: number;
  providerBlocked: number;
  providerTimeouts: number;
  rawSearchResults: number;
  normalizedResults: number;
  deduplicatedResults: number;
}

export interface PublicHiringPostDiscoveryResult {
  candidates: ProactiveRecruiterDiscoveryCandidate[];
  metrics: PublicHiringPostDiscoveryMetrics;
}

export interface PublicHiringPostDiscoveryInput {
  targetRoles: string[];
  skills: string[];
  yearsExperience?: number;
  location?: string;
  preferredLocations?: string[];
  maxQueries?: number;
  signal?: AbortSignal;
  fetchText?: (url: string, signal?: AbortSignal, headers?: Record<string,string>) => Promise<string | null>;
}

const HIRING_INTENT = /(?:we['’]?re\s+hiring|we\s+are\s+hiring|my\s+team\s+is\s+hiring|we['’]?re\s+looking\s+for|we\s+are\s+looking\s+for|looking\s+for\s+(?:a|an)?\s*(?:frontend|front-end|front\s+end|react|next\.js|javascript|typescript|software|full[ -]?stack|web)\s*(?:developer|engineer|developers|engineers)|hiring\s+(?:for\s+)?(?:a\s+)?(?:frontend|front-end|front\s+end|react|next\.js|javascript|typescript|software|full[ -]?stack|web)|join\s+(?:our|my)\s+team|send\s+(?:your|me\s+your)\s+(?:resume|cv)|share\s+your\s+(?:resume|cv)|dm\s+(?:me|us)\s+(?:if|for)|reach\s+out\s+(?:with|to)|apply\s+(?:here|now)|referrals?\s+welcome|know\s+someone\s+who)/i;
const JOB_POSTING_INTENT = /(?:apply\s*(?:now|here)|apply\s+for\s+(?:this|the)\s+(?:job|role)|job\s+description|responsibilities|qualifications|required\s+(?:skills|experience)|employment\s+type|job\s+type|submit\s+(?:an\s+)?application|application\s+instructions|easy\s+apply|what\s+you['’]?ll\s+work\s+on|what\s+we['’]?re\s+looking\s+for|key\s+(?:skills|requirements)|must\s+have)/i;

const FRONTEND_EVIDENCE = [
  /\breact(?:\.js)?\b/i,
  /\bnext\.?js\b/i,
  /\breact\s+native\b/i,
  /\btypescript\b/i,
  /\bjavascript\b/i,
  /\bhtml(?:5)?\b/i,
  /\bcss(?:3)?\b/i,
  /\bresponsive\b/i,
  /\b(?:redux|context\s*api|zustand|mobx|state\s+management)\b/i,
  /\b(?:rest\s*api|restful\s*api|api\s+integration|graphql)\b/i,
  /\b(?:hooks|component\s+architecture|component\s+library|design\s+system|ui\s+components?)\b/i,
  /\b(?:frontend|front-end|front\s+end|user-facing|web\s+application|web\s+app)\b/i,
  /\b(?:jest|react\s+testing\s+library|playwright|cypress)\b/i,
  /\b(?:web\s+performance|core\s+web\s+vitals|browser\s+rendering)\b/i,
];
const BACKEND_EVIDENCE = [
  /\bnode(?:\.js)?\b/i,
  /\bexpress(?:\.js)?\b/i,
  /\bnest(?:\.js)?\b/i,
  /\bfastify\b/i,
  /\bmongodb\b/i,
  /\b(?:sql|postgres(?:ql)?|mysql)\b/i,
  /\b(?:backend|back-end|server-side|api\s+development)\b/i,
];

const AUTHOR_ROLE = /recruiter|recruiting|talent\s+acquisition|talent\s+partner|talent\s+advisor|technical\s+recruiter|engineering\s+recruiter|hiring\s+manager|human\s+resources|\bhr\b|people\s+(?:ops|operations|partner)|founder|co-founder|cofounder|hiring\s+lead|team\s+lead|engineering\s+manager/i;
const EXPLICIT_RECRUITING_ACTION = /(?:my|our)\s+team\s+is\s+hiring|\bi['’]?m\s+hiring\b|\bi\s+am\s+hiring\b|join\s+(?:my|our)\s+team|we['’]?re\s+hiring\s+at|we\s+are\s+hiring\s+at/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const POST_URL = /(?:https?:\/\/)?(?:www\.|[a-z]{2}\.)?linkedin\.com\/(?:posts\/[^\s<>"'\\)]+|feed\/update\/urn:li:activity:\d+)/gi;
const PROFILE_URL = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const LINKEDIN_POST_URL = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/(?:posts\/[^\s<>"]+|feed\/update\/urn:li:activity:\d+)/i;
const SEARCH_HOSTS = new Set(["google.com","www.google.com","bing.com","www.bing.com","duckduckgo.com","html.duckduckgo.com","startpage.com","www.startpage.com","search.yahoo.com","www.yahoo.com","search.brave.com","www.mojeek.com","qwant.com","www.qwant.com"]);
const GENERIC_EMAIL_DOMAINS = new Set(["gmail.com","outlook.com","hotmail.com","yahoo.com","icloud.com","proton.me","protonmail.com"]);
const GENERIC_EMPLOYER_DOMAINS = new Set(["example.com","example.org","example.net","localhost"]);
const TALENT_VENDOR_PATTERNS = [
  /\btalent solutions\b/i,
  /\btalent cloud\b/i,
  /\b(?:pre[- ]screened|pre[- ]vetted)\s+(?:candidates|talent|developers|engineers)\b/i,
  /\b(?:executive search|staff augmentation|talent sourcing|developer sourcing)\b/i,
  /\bhire\s+(?:top|the)\s+\d{1,3}%\s+of\b/i,
  /\b(?:pool|network)\s+of\s+[\d,]+\+?\s+(?:developers|engineers|experts|talents)\b/i,
  /\b(?:recruitment|recruiting|talent)\s+(?:agency|firm|services)\b/i,
];

function isTalentVendorPage(text: string): boolean {
  const normalized = clean(text);
  const hits = TALENT_VENDOR_PATTERNS.reduce((count, pattern) => count + (pattern.test(normalized) ? 1 : 0), 0);
  const candidateMarketplace = /\b(?:apply as (?:a )?developer|join (?:our|the) talent pool|become (?:a )?developer|for developers)\b/i.test(normalized);
  return hits >= 2 || (hits >= 1 && candidateMarketplace);
}


const MAX_DESTINATION_URLS_PER_SEARCH = 8;
const MAX_POST_EVIDENCE = 16;
const MAX_PROFILE_URLS_PER_SEARCH = 4;
const PUBLIC_HIRING_RUNTIME_TIMEOUT_MS = 45_000;

function clean(value: string): string {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
}
function canonicalUrl(value: string): string {
  try {
    const u = new URL(value);
    u.hash = "";
    ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","trk","trackingId","refId","lipi"].forEach(k => u.searchParams.delete(k));
    return u.toString().replace(/\/$/, "");
  } catch { return value.replace(/\/+$/, ""); }
}
function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
}
function plausibleName(value: string): boolean {
  const v = value.trim().replace(/\s+/g, " ");
  if (v.length < 5 || v.length > 80) return false;
  if (/^(the|we|our|my|team|hiring|frontend|react|software|developer|engineer|post)\b/i.test(v)) return false;
  const parts = v.split(" ");
  return parts.length >= 2 && parts.length <= 5 && parts.every(p => /^[A-Z][A-Za-z.'-]*$/.test(p));
}
function extractAuthorNameCandidate(value: string): string | undefined {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  for (let count = Math.min(5, tokens.length); count >= 2; count--) {
    const candidate = tokens.slice(-count).join(" ");
    if (plausibleName(candidate)) return candidate;
  }
  return undefined;
}
function profileFromPostUrl(_url: string): string | undefined {
  return undefined;
}
function extractAuthor(text: string, postUrl: string): { name?: string; profileUrl?: string } {
  const patterns = [
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:2d|3d|4d|5d|6d|1w|2w|3w|4w|1mo|2mo|3mo|4mo|5mo|6mo)\b/i,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})['’]s\s+(?:Post|post)\b/i,
    /#?(?:hiring|we.?re.?hiring)[^\n]{0,80}\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s*\b(?:posted|shared)/i,
    /(?:^|\n)([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s*[-|]\s*LinkedIn/i,
    /(?:^|\n)([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:2d|3d|4d|5d|6d|1w|2w|3w|4w|1mo|2mo|3mo|4mo|5mo|6mo)\b/i
  ];
  for (const pattern of patterns) {
    const name = extractAuthorNameCandidate(text.match(pattern)?.[1] ?? "");
    if (name) return { name, profileUrl: profileFromPostUrl(postUrl) };
  }
  const profileUrl = profileFromPostUrl(postUrl);
  const slugName = profileUrl?.split("/in/")[1]?.replace(/[-_]+/g, " ");
  if (slugName) {
    const name = slugName.split(" ").map(p => p ? p.charAt(0).toUpperCase()+p.slice(1) : p).join(" ");
    if (plausibleName(name)) return { name, profileUrl };
  }
  return { profileUrl };
}
function extractEmployer(text: string, email?: string, profileText?: string, sourceUrl?: string): { name?: string; domain?: string } {
  const haystack = [text, profileText ?? ""].join(" ");
  const emailDomain = email?.split("@")[1]?.toLowerCase();
  const strongAt = haystack.match(/\bat\s+([A-Z][A-Za-z0-9&.' -]{2,80})(?=\s*[.!?](?:\s|$)|\s+(?:Location|Experience|Skills?)\s*:|$)/)?.[1]?.trim();
  const linkedinEmployer = haystack.match(/(?:^|\n)[^\n]{1,120}?\s+-\s+([A-Z][A-Za-z0-9&.' -]{2,80})\s+\|\s+LinkedIn/i)?.[1]?.trim();
  const hiringEmployer = haystack.match(/([A-Z][A-Za-z0-9&.' -]{2,80})\s+(?:is|are)\s+(?:hiring|looking for)/i)?.[1]?.trim();
  const explicitCompany = haystack.match(/\b(?:company|employer|organization|organisation)\s*[:=-]\s*([A-Z][A-Za-z0-9&.' -]{2,80}?)(?=\s+(?:frontend|front-end|front\s+end|react|next\.js|javascript|typescript|software|full[ -]?stack|job\s+description|responsibilities|qualifications|employment\s+type|apply\s+(?:now|here)|\d{4})\b|$)/i)?.[1]?.trim();
  const structuredCompany = haystack.match(/"@type"\s*:\s*"Organization"[\s\S]{0,500}?"name"\s*:\s*"([^"]{2,100})"/i)?.[1]?.trim();
  const titleCompany = haystack.match(/<title[^>]*>\s*[^<]{2,140}?\s+(?:at|@|\||-|–|—)\s*([A-Z][A-Za-z0-9&.' -]{2,80})\s*(?:\||-|–|—|<)/i)?.[1]?.trim();
  const roleTitleCompany = haystack.match(/(?:frontend|front-end|front\s+end|react|next\.js|javascript|typescript|software|full[ -]?stack|web)\s+(?:developer|engineer)[^.!?\n]{0,80}?[—–|]\s*([A-Z][A-Za-z0-9&.' ]{2,80})(?=\s+(?:Posted|We['’]?re|We are|React|TypeScript|JavaScript|Experience|Send)|$)/i)?.[1]?.trim();
  const plainTitleCompany = haystack.match(/^(?:[^.!?\n]{2,140}?)\s+(?:at|@|[-–—|])\s*([A-Z][A-Za-z0-9&.' ]{2,80})(?=\s+(?:Posted|We['’]?re|We are|React|TypeScript|JavaScript|Experience|Send)|$)/i)?.[1]?.trim();
  const companyPath = sourceUrl?.match(/\/(?:companies?|employers?)\/([^/?#]+)\/(?:jobs?|roles?)\//i)?.[1]?.replace(/[-_]+/g, " ").trim();
  let name = strongAt || linkedinEmployer || hiringEmployer || explicitCompany || structuredCompany || titleCompany || roleTitleCompany || plainTitleCompany || (companyPath ? companyPath.replace(/\b\w/g, c => c.toUpperCase()) : undefined);
  const urlDomains = [...haystack.matchAll(/https?:\/\/([^\s/<>"']+)/gi)]
    .map(m => normalizeDomain(m[1] ?? ""))
    .filter(d => d && !SEARCH_HOSTS.has(d) && !d.endsWith("linkedin.com"));
  // Never adopt an arbitrary URL domain as the employer domain. Search/profile
  // evidence often contains unrelated links (for example, navigation or
  // third-party resources). A domain is usable here only when it independently
  // matches the extracted employer name; a direct email domain gets the same
  // identity check before it can establish employer ownership.
  // A direct recruiting mailbox is first-party employer-domain evidence.
  // Do not require brittle company-name token matching here; employer names
  // commonly include suffixes such as "association" or differ from domains.
  const emailBackedDomain = emailDomain && !GENERIC_EMAIL_DOMAINS.has(emailDomain)
    ? emailDomain
    : undefined;
  const urlBackedDomain = urlDomains.find(d => d && !/^lnkd\.in$/i.test(d) && !!name && domainMatchesEmployerName(d, name));
  // Arbitrary page URLs still require an employer-name/domain match.
  const domain = emailBackedDomain ?? urlBackedDomain;
  const usableEmployerDomain = domain && !GENERIC_EMPLOYER_DOMAINS.has(domain) ? domain : undefined;
  if (emailDomain && name && /\b(?:hiring[- ]frontend|frontend[- ]developer|hiring[- ]react|react[- ]developer|min\s+read|skip\s+to|navigation)\b/i.test(name)) name = undefined;
  if (!name && usableEmployerDomain) name = usableEmployerDomain.split(".")[0]?.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  if (name && usableEmployerDomain) return { name: name.replace(/[|•,.-]+$/, "").trim(), domain: usableEmployerDomain };
  if (name) return { name: name.replace(/[|•,.-]+$/, "").trim() };
  return {};
}

function domainMatchesEmployerName(domain: string, employerName: string): boolean {
  const root = normalizeDomain(domain).split(".")[0] ?? "";
  const tokens = employerName.toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 3 && !["the","and","inc","ltd","llc","corp","company","limited","private","pvt"].includes(token));
  return Boolean(root && tokens.length && tokens.some(token => root.includes(token)));
}

function hasFrontendEvidence(text: string): boolean {
  const hits = FRONTEND_EVIDENCE.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  const reactLike = /\b(?:react(?:\.js)?|next\.?js|react\s+native)\b/i.test(text);
  const webLanguage = /\b(?:typescript|javascript|html(?:5)?|css(?:3)?)\b/i.test(text);
  const uiOrApi = /\b(?:hooks|components?|state\s+management|redux|context|responsive|rest\s*api|graphql|ui|user-facing|dashboard|design\s+system|web\s+application)\b/i.test(text);
  return hits >= 3 || (reactLike && webLanguage && uiOrApi);
}

function hasHiringIntent(text: string): boolean {
  if (HIRING_INTENT.test(text)) return true;
  return JOB_POSTING_INTENT.test(text) && hasFrontendEvidence(text);
}

export function substantiveRoleEvidence(text: string): { role?: string; score: number; terms: string[] } {
  const terms: string[] = [];
  const frontendHits = FRONTEND_EVIDENCE.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  const backendHits = BACKEND_EVIDENCE.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
  const react = /\breact(?:\.js)?\b/i.test(text);
  const next = /\bnext\.?js\b/i.test(text);
  const web = /\b(?:web\s+application|web\s+app|responsive|user-facing|frontend|front-end|front\s+end)\b/i.test(text);
  const javascript = /\bjavascript\b/i.test(text);
  const typescript = /\btypescript\b/i.test(text);
  const api = /\b(?:rest\s*api|restful\s*api|graphql|api\s+integration)\b/i.test(text);
  const node = /\b(?:node(?:\.js)?|express(?:\.js)|nest(?:\.js)|fastify)\b/i.test(text);

  if (react && (web || frontendHits >= 4)) { terms.push("React", "Frontend"); }
  if (next && react) terms.push("Next.js");
  if (typescript) terms.push("TypeScript");
  if (javascript) terms.push("JavaScript");
  if (node && (react || backendHits >= 2)) terms.push("Node.js");
  if (api) terms.push("REST APIs");

  let role: string | undefined;
  let score = 0;
  if (react && node && (api || backendHits >= 2)) { role = "Full Stack Developer — React"; score = 82 + Math.min(13, frontendHits + backendHits); }
  else if (react && (web || frontendHits >= 4)) { role = "Frontend Developer"; score = 82 + Math.min(13, frontendHits); }
  else if (next && web && (javascript || typescript)) { role = "Next.js Developer"; score = 80 + Math.min(15, frontendHits); }
  else if (web && javascript && frontendHits >= 4) { role = "Web Developer"; score = 78 + Math.min(17, frontendHits); }
  if (!role) return { score: 0, terms: [] };
  return { role, score: Math.min(100, score), terms: [...new Set(terms)] };
}
function extractRole(text: string): { role?: string; score: number; terms: string[] } { return substantiveRoleEvidence(text); }

export function experienceCompatible(text: string, candidateYears = 3): boolean {
  const ranges = [...text.matchAll(/(\d+)\s*(?:-|to|–|—)\s*(\d+)\s*years?/gi)].map(m => [Number(m[1]), Number(m[2])] as const);
  const minimums = [...text.matchAll(/(?:\b|\D)(\d+)\s*\+\s*years?/gi)].map(m => Number(m[1]));
  if (!ranges.length && !minimums.length) return true;
  if (ranges.length + minimums.length === 1) {
    if (ranges.length) return candidateYears >= ranges[0]![0];
    return candidateYears >= minimums[0]!;
  }
  return ranges.some(([min, max]) => candidateYears >= min && candidateYears <= max) || minimums.some(min => candidateYears >= min);
}

function normalizeEmailNamePart(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
}

export function recruiterEmailLocalPartMatchesName(name: string, localPart: string): boolean {
  let normalizedLocal = normalizeEmailNamePart(localPart.split("+")[0] ?? "");
  if (!normalizedLocal) return false;
  const numericSuffix = normalizedLocal.match(/\d{1,4}$/)?.[0] ?? "";
  if (numericSuffix) normalizedLocal = normalizedLocal.slice(0, -numericSuffix.length);
  const parts = name.trim().split(/\s+/).map(normalizeEmailNamePart).filter(Boolean);
  if (parts.length < 2) return false;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  if (first.length < 2 || last.length < 2) return false;
  const middleInitials = parts.slice(1, -1).map(part => part[0] ?? "").join("");
  const allInitials = parts.map(part => part[0] ?? "").join("");
  const firstInitial = first[0] ?? "";
  const lastInitial = last[0] ?? "";
  const fullName = parts.join("");
  const aliases = new Set<string>([
    first,
    last,
    first + last,
    last + first,
    firstInitial + last,
    last + firstInitial,
    first + lastInitial,
    last + firstInitial,
    firstInitial + lastInitial,
    allInitials,
    fullName,
    first + middleInitials + last,
    first + middleInitials,
    firstInitial + middleInitials + last,
  ]);
  for (const width of [1, 2, 3, 4]) {
    aliases.add(first.slice(0, width) + last); aliases.add(last.slice(0, width) + first); aliases.add(first + last.slice(0, width)); aliases.add(last + first.slice(0, width)); aliases.add(firstInitial + last.slice(0, width)); aliases.add(lastInitial + first.slice(0, width));
  }
  for (const alias of aliases) if (alias.length >= 3 && alias === normalizedLocal) return true;
  return false;
}

const GENERIC_RECRUITING_MAILBOXES = new Set(["hr","careers","career","jobs","job","recruitment","recruiting","talent","hiring","apply","joinus","join-us","workwithus","work-with-us","info"]);
const NON_RECRUITING_MAILBOXES = new Set(["support","admin","press","media","legal","privacy","marketing","machine","postmaster","webmaster","noreply","no-reply"]);

function usableDirectEmail(email: string | undefined, employerDomain?: string): boolean {
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || GENERIC_EMAIL_DOMAINS.has(domain)) return false;
  return !employerDomain || domain === employerDomain.toLowerCase();
}
function hasRecruitingEmailEvidence(text: string, email: string): boolean {
  const index = text.toLowerCase().indexOf(email.toLowerCase());
  if (index < 0) return false;
  const context = text.slice(Math.max(0, index - 650), Math.min(text.length, index + 650));
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  const normalizedMailbox = localPart.replace(/[._-]+/g, "");
  if (NON_RECRUITING_MAILBOXES.has(localPart) || NON_RECRUITING_MAILBOXES.has(normalizedMailbox) || /(?:^|[-_.])(machine|bot|system|automation|automated|donotreply)(?:[-_.]|$)/.test(localPart)) return false;
  return /(?:resume|cv|apply|hiring|recruiting|recruiter|talent|job|referral|join (?:our|my) team|share (?:your|the) (?:resume|cv)|drop (?:your|the) (?:resume|cv))/i.test(context);
}
function extractDirectEmail(text: string): string | undefined {
  const found = [...new Set((text.match(EMAIL) ?? []).map(v => v.toLowerCase()))].filter(isPlausibleMailboxAddress).filter(e => !/^(noreply|no-reply)@/i.test(e));
  const ranked = [...found].sort((a, b) => Number(GENERIC_RECRUITING_MAILBOXES.has(a.split("@")[0]?.toLowerCase() ?? "")) - Number(GENERIC_RECRUITING_MAILBOXES.has(b.split("@")[0]?.toLowerCase() ?? "")));
  return ranked.find(e => hasRecruitingEmailEvidence(text, e));
}

async function fetchText(url: string, signal?: AbortSignal, timeoutMs = 6500): Promise<string | null> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs); const onAbort = () => controller.abort(); signal?.addEventListener("abort", onAbort, { once: true });
  try { const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept: "text/html,text/plain,*/*;q=0.8", "user-agent": "Mozilla/5.0 (compatible; job-agent-public-hiring-posts/1.0)" } }); if (!response.ok) return null; return await response.text(); }
  catch { return null; } finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
}
async function search(query: string, signal?: AbortSignal, fetchTextOverride?: (url: string, signal?: AbortSignal, headers?: Record<string,string>) => Promise<string | null>): Promise<Array<{ source: SourceId; text: string }>> {
  const results: Array<{ source: SourceId; text: string }> = [];
  for (const provider of sourceList(query)) { if (signal?.aborted) break; const text = await (fetchTextOverride ? fetchTextOverride(provider.url, signal, provider.headers) : fetchText(provider.url, signal)); if (text) results.push({ source: provider.id, text }); }
  return results;
}
function configuredSearchInfrastructureHosts(): Set<string> { const hosts = new Set<string>(); for (const provider of sourceList("")) { try { hosts.add(new URL(provider.url).hostname.toLowerCase().replace(/^www\./, "")); } catch {} } return hosts; }
function isLegitimatePublicResultUrl(value: string, infrastructureHosts: Set<string>): boolean {
  try { const parsed = new URL(value); if (!/^https?:$/.test(parsed.protocol)) return false; const host = parsed.hostname.toLowerCase().replace(/^www\./, ""); const path = parsed.pathname.toLowerCase(); if (!host || host === "localhost" || SEARCH_HOSTS.has(host) || host.endsWith(".qwant.com") || infrastructureHosts.has(host)) return false; if ([...infrastructureHosts].some(infrastructureHost => host.endsWith(`.${infrastructureHost}`))) return false; if (host === "r.jina.ai" || host.endsWith(".r.jina.ai")) return false; if (host.endsWith("linkedin.com") && /^\/(?:jobs|in)\//i.test(parsed.pathname)) return false; if (/^\/(?:api|v[0-9]+|ajax|graphql|search|query|suggest|autocomplete|static|assets?|tags?|scripts?|js|css)(?:\/|$)/i.test(path)) return false; if (/\.(?:js|css|map|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|xml)(?:$|[?#])/i.test(path)) return false; if (/^chrome(?:-extension)?:$/i.test(parsed.protocol) || /(?:^|\.)chrome\.google\.com$/i.test(host)) return false; return true; } catch { return false; }
}
function isSafePublicDestinationUrl(value: string): boolean {
  try { const u = new URL(value); const decoded = decodeURIComponent(value); if (u.protocol !== "http:" && u.protocol !== "https:") return false; if (/\/https?:\/\//i.test(decoded) || /https?:\/\/.*\/https?:\/\//i.test(decoded)) return false; if (/%3a%2f%2f/i.test(value) && /(?:^|\/)https?:/i.test(decoded)) return false; const host = u.hostname.toLowerCase(); if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false; if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(host)) return false; if (/^172\.(?:1[6-9]|2\d|3[0-1])\./.test(host)) return false; return true; } catch { return false; }
}
function decodeSearchResultText(value: string): string {
  let current = value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u002F/gi, "/")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003D/gi, "=")
    .replace(/\\u003d/gi, "=")
    .replace(/\\\//g, "/");
  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}
function extractPublicEvidenceUrls(text: string): string[] {
  const infrastructureHosts = configuredSearchInfrastructureHosts();
  const decoded = decodeSearchResultText(text);
  const candidates = [
    ...(text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []),
    ...(decoded.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []),
    ...[...text.matchAll(/\b(?:href|url|target|destination|clickurl|targeturl|data-href|data-url)\s*=\s*["']([^"']+)["']/gi)].map(match => match[1] ?? ""),
    ...[...text.matchAll(/\[[^\]]+\]\((https?:[^)]+)\)/gi)].map(match => match[1] ?? "")
  ];
  const urls = [...new Set(candidates
    .map(value => decodeSearchResultText(value).replace(/[),.;]+$/, ""))
    .map(value => canonicalUrl(value))
    .filter(value => isLegitimatePublicResultUrl(value, infrastructureHosts)))];
  return urls;
}
function extractProfileUrlFromSearch(text: string, name: string): string | undefined { const urls = [...new Set((text.match(PROFILE_URL) ?? []).map(canonicalUrl))]; const tokens = name.toLowerCase().split(/\s+/).filter(Boolean); return urls.find(url => tokens.length >= 2 && tokens.every(token => url.toLowerCase().includes(token.replace(/[^a-z0-9-]/g, "")))); }
function extractProfileUrls(text: string): string[] { return [...new Set((text.match(PROFILE_URL) ?? []).map(canonicalUrl))].filter(url => !/\/pub\/dir\//i.test(url)); }
function extractProfileName(profileText: string, profileUrl: string): string | undefined { const title = profileText.match(/(?:^|<title>)\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+-\s+/i)?.[1]; if (title && plausibleName(title)) return title.trim(); try { const slug = new URL(profileUrl).pathname.match(/^\/in\/([^/?#]+)/i)?.[1]; const name = slug?.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()); if (name && plausibleName(name)) return name; } catch {} return undefined; }
function extractHiringSnippets(profileText: string): string[] { const text = clean(profileText); const re = new RegExp(HIRING_INTENT.source, "gi"); const snippets: string[] = []; for (const match of text.matchAll(re)) { const index = match.index ?? 0; const snippet = text.slice(Math.max(0, index - 1000), Math.min(text.length, index + 3500)).trim(); if (snippet && !snippets.includes(snippet)) snippets.push(snippet); } return snippets.slice(0, 8); }
function buildEvidence(text: string, postUrl: string): string {
  const infrastructureHosts = configuredSearchInfrastructureHosts();
  const decodedText = decodeSearchResultText(text);
  const targetVariants = new Set<string>([
    postUrl,
    decodeSearchResultText(postUrl),
    canonicalUrl(postUrl)
  ]);
  try {
    const target = new URL(postUrl);
    targetVariants.add(target.origin + target.pathname);
    targetVariants.add(target.hostname + target.pathname);
    targetVariants.add(target.pathname);
  } catch {}
  const lowerText = decodedText.toLowerCase();
  let index = -1;
  let matchedLength = 0;
  for (const variant of targetVariants) {
    const normalizedVariant = variant.trim();
    if (!normalizedVariant) continue;
    const candidateIndex = lowerText.indexOf(normalizedVariant.toLowerCase());
    if (candidateIndex >= 0 && (index < 0 || candidateIndex < index)) {
      index = candidateIndex;
      matchedLength = normalizedVariant.length;
    }
  }
  if (index < 0) {
    const targetHost = (() => {
      try { return new URL(postUrl).hostname.toLowerCase(); } catch { return ""; }
    })();
    if (targetHost) {
      const hostIndex = lowerText.indexOf(targetHost);
      if (hostIndex >= 0) {
        index = hostIndex;
        matchedLength = targetHost.length;
      }
    }
  }
  if (index < 0) return "";
  const window = decodedText.slice(Math.max(0, index - 1800), Math.min(decodedText.length, index + Math.max(2600, matchedLength)));
  const sanitized = window.replace(/https?:\/\/[^\s<>"')\]]+/gi, url => isLegitimatePublicResultUrl(url, infrastructureHosts) ? url : "");
  return sanitized.replace(/\s+/g, " ").trim().slice(0, 4400);
}
function freshness(evidence: string): ProactiveRecruiterDiscoveryCandidate["evidenceFreshness"] { if (/\b(?:today|1d|2d|3d|4d|5d|6d|1w|2w|3w|4w|1mo|2mo|3mo|4mo)\b/i.test(evidence)) return "current"; if (/\b(?:5mo|6mo|7mo|8mo|9mo|10mo|11mo|12mo)\b/i.test(evidence)) return "recent"; const years = [...evidence.matchAll(/\b(20\d{2})\b/g)].map(match => Number(match[1])).filter(Number.isFinite); const currentYear = new Date().getFullYear(); if (years.some(year => year === currentYear)) return "current"; if (years.some(year => year === currentYear - 1)) return "recent"; if (years.some(year => year < currentYear - 1)) return "historical"; return "unknown"; }
function canonicalIdentityKey(name: string | undefined, employer: string, _evidenceKey: string, email?: string): string { if (email) return `email:${email.toLowerCase()}`; if (!name) return `employer:${employer.toLowerCase().replace(/[^a-z0-9]+/g,"").trim()}`; return `${name.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}|${employer.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}`; }

export class PublicHiringPostDiscoveryProvider {
  async discover(input: PublicHiringPostDiscoveryInput): Promise<PublicHiringPostDiscoveryResult> {
    const runtimeSignal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(PUBLIC_HIRING_RUNTIME_TIMEOUT_MS)]) : AbortSignal.timeout(PUBLIC_HIRING_RUNTIME_TIMEOUT_MS);
    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 8, 12));
    const roleTerms = input.targetRoles.length ? input.targetRoles.slice(0, 8) : ["Frontend Engineer","Frontend Developer","React Developer"];
    const queries = [...roleTerms.slice(0, 4).map(role => `"${role}" hiring React`), `"we're hiring" "frontend" React`, `"we are hiring" "frontend" React`, `"my team is hiring" frontend React`, `"send your resume" "frontend" React`, `"looking for" "React Developer" Bangalore`, `"Frontend Developer" "TypeScript" Bangalore`].slice(0, maxQueries);
    const profileQueries = ['site:linkedin.com/in "we\'re hiring" "frontend developer" Bangalore','site:linkedin.com/in "we are hiring" React Bangalore','site:linkedin.com/in "my team is hiring" React India','site:linkedin.com/in "share your resume" React Bengaluru'];
    const metrics: PublicHiringPostDiscoveryMetrics = { queriesGenerated: queries.length + profileQueries.length, queriesExecuted: 0, sourcePagesFetched: 0, publicPostUrls: 0, configuredProviders: 0, eligibleProviders: 0, executedProviders: 0, skippedProviders: 0, providerFailures: 0, providerRateLimited: 0, providerBlocked: 0, providerTimeouts: 0, rawSearchResults: 0, normalizedResults: 0, deduplicatedResults: 0, hiringIntentPosts: 0, relevantRolePosts: 0, employersExtracted: 0, authorsExtracted: 0, validatedIdentities: 0, validatedContacts: 0, directEmails: 0, publiclyDiscoveredEmails: 0, rejectedPosts: 0, duplicatePosts: 0, sourceStats: {} };
    const candidates = new Map<string, ProactiveRecruiterDiscoveryCandidate>();
    const configuredProviderIds = new Set<string>();
    const postEvidence = new Map<string, { url: string; text: string; discoveryText: string; source: string }>();
    for (const query of queries) {
      if (runtimeSignal?.aborted) break;
      metrics.queriesExecuted++;
      const providersForQuery = sourceList(query);
      for (const provider of providersForQuery) configuredProviderIds.add(provider.id);
      const results = await search(query, runtimeSignal, input.fetchText);
      for (const result of results) {
        metrics.sourcePagesFetched++;
        metrics.rawSearchResults += (result.text.match(/https?:\/\/[^\s<>"'\\)\\]]+/gi) ?? []).length;
        const stat = metrics.sourceStats[result.source] ?? (metrics.sourceStats[result.source] = { attempted:0,succeeded:0,empty:0,errors:0,posts:0 }); stat.attempted++; stat.succeeded++;
        const urls = extractPublicEvidenceUrls(result.text).slice(0, MAX_DESTINATION_URLS_PER_SEARCH); metrics.normalizedResults += urls.length; stat.posts += urls.length;
        for (const url of urls) {
          if (postEvidence.has(url)) { metrics.duplicatePosts++; metrics.deduplicatedResults++; continue; }
          if (!isSafePublicDestinationUrl(url)) continue;
          const discoveryEvidence = buildEvidence(result.text, url);
          const indexedPost = LINKEDIN_POST_URL.test(url) && hasHiringIntent(discoveryEvidence);
          const fetchedPostPage = await (input.fetchText ? input.fetchText(url, runtimeSignal) : fetchText(url, runtimeSignal, 6500));
          const fetchedEvidence = fetchedPostPage ? clean(fetchedPostPage).slice(0, 12000) : "";
          const jobLikeDestination = /(?:\/(?:jobs?|careers?|vacanc(?:y|ies)|positions?|openings?|roles?|hiring)(?:\/|$))/i.test(new URL(url).pathname);
          const vendorPage = isTalentVendorPage(fetchedEvidence);
          const candidateEmailFromEvidence = extractDirectEmail(fetchedEvidence) ?? extractDirectEmail(discoveryEvidence);
          // Generic frontend/resource pages can contain job vocabulary such as
          // "job description" or "apply" without being hiring evidence. A
          // non-job destination is therefore admissible only when it is an
          // indexed hiring post or contains a concrete recruiting mailbox.
          const hiringDestinationEvidence = !vendorPage && (indexedPost || jobLikeDestination || Boolean(candidateEmailFromEvidence));
          const fetchedEvidenceUsable = hasHiringIntent(fetchedEvidence) && hiringDestinationEvidence;
          const searchEvidenceIsUsable = hasHiringIntent(discoveryEvidence) && hiringDestinationEvidence;
          const evidence = fetchedEvidenceUsable ? fetchedEvidence : (searchEvidenceIsUsable ? clean(discoveryEvidence).slice(0, 7000) : "");
          if (!evidence || !hasHiringIntent(evidence)) continue;
          metrics.hiringIntentPosts++;
          const extractedRole = extractRole(evidence);
          if (!extractedRole.role || extractedRole.score < 78 || !experienceCompatible(evidence, input.yearsExperience ?? 3)) { metrics.rejectedPosts++; continue; }
          metrics.relevantRolePosts++;
          if (process.env.PUBLIC_HIRING_POST_DIAGNOSTICS === "true" && postEvidence.size < 12) console.error(JSON.stringify({ event: "public-hiring-post-evidence", source: result.source, url, evidence: evidence.slice(0, 5000) }));
          postEvidence.set(url, { url, text: evidence, discoveryText: discoveryEvidence, source: result.source });
          if (postEvidence.size >= MAX_POST_EVIDENCE) break;
        }
      }
    }
    metrics.configuredProviders = configuredProviderIds.size; metrics.eligibleProviders = configuredProviderIds.size; metrics.executedProviders = configuredProviderIds.size; metrics.providerFailures = Math.max(0, metrics.eligibleProviders - metrics.executedProviders);
    for (const query of profileQueries) {
      if (runtimeSignal?.aborted) break;
      const results = await search(query, runtimeSignal, input.fetchText);
      for (const result of results) {
        metrics.sourcePagesFetched++;
        const profileUrls = extractProfileUrls(result.text).slice(0, MAX_PROFILE_URLS_PER_SEARCH);
        for (const profileUrl of profileUrls) {
          if (profileUrl.includes("/pub/dir/")) continue;
          const profileText = clean(await (input.fetchText ? input.fetchText(profileUrl, runtimeSignal) : fetchText(profileUrl, runtimeSignal, 6500)) ?? "");
          if (!profileText) continue;
          const authorName = extractProfileName(profileText, profileUrl); if (!authorName) continue;
          const snippets = extractHiringSnippets(profileText);
          for (const snippet of snippets) {
            const role = extractRole(snippet); if (!role.role || role.score < 78 || !experienceCompatible(snippet, input.yearsExperience ?? 3)) continue;
            metrics.hiringIntentPosts++; metrics.relevantRolePosts++;
            const candidateEmail = extractDirectEmail(snippet); const directEmail = candidateEmail && hasRecruitingEmailEvidence(snippet, candidateEmail) ? candidateEmail : undefined; if (directEmail) metrics.directEmails++;
            const employer = extractEmployer(profileText, directEmail, profileText); if (!employer.name) continue; metrics.employersExtracted++;
            const explicitAction = EXPLICIT_RECRUITING_ACTION.test(snippet); if (!AUTHOR_ROLE.test(profileText) && !explicitAction) continue;
            metrics.authorsExtracted++; metrics.validatedIdentities++;
            const evidenceFreshness = freshness(snippet); if (evidenceFreshness === "unknown") continue;
            const key = canonicalIdentityKey(authorName, employer.name, profileUrl + "|" + snippet.slice(0, 220)); if (candidates.has(key)) { metrics.duplicatePosts++; continue; }
            candidates.set(key, { recruiterName: authorName, recruiterRole: AUTHOR_ROLE.test(profileText) ? (profileText.match(AUTHOR_ROLE)?.[0] ?? "Hiring Lead") : "Hiring Lead", employer: employer.name, ...(employer.domain ? { employerDomain: employer.domain } : {}), targetRoles: role.terms, roleMatchScore: role.score, hiringEvidenceScore: 90, overallConfidence: Math.min(100, role.score + (employer.domain ? 10 : 0) + 5), discoverySource: "public-web", discoveryUrl: profileUrl, discoveryEvidence: [snippet.slice(0, 5000), profileText.slice(0, 1800)].filter(Boolean), evidenceType: "job_hiring_evidence", evidenceDate: new Date().toISOString(), evidenceFreshness, ...(usableDirectEmail(directEmail, employer.domain) ? { email: directEmail } : {}), emailStatus: "UNVERIFIED" });
            metrics.publicPostUrls++;
          }
        }
      }
    }
    metrics.publicPostUrls = Math.max(metrics.publicPostUrls, postEvidence.size);
    for (const post of postEvidence.values()) {
      if (runtimeSignal?.aborted) break;
      const identitySearchEvidence = `${post.text} ${post.discoveryText}`;
      let author = extractAuthor(identitySearchEvidence, post.url); let profileText = ""; let profileUrl = author.profileUrl;
      if (!author.name) {
        const indexedProfileUrl = extractProfileUrls(post.text)[0];
        if (indexedProfileUrl) { profileUrl = indexedProfileUrl; profileText = clean(await (input.fetchText ? input.fetchText(profileUrl, runtimeSignal) : fetchText(profileUrl, runtimeSignal, 5000)) ?? ""); const resolvedName = profileText ? extractProfileName(profileText, profileUrl) : undefined; if (resolvedName) author = { name: resolvedName, profileUrl }; }
      }
      const candidateEmail = extractDirectEmail(post.text) ?? extractDirectEmail(post.discoveryText); const directEmail = candidateEmail && hasRecruitingEmailEvidence(`${post.text} ${post.discoveryText}`, candidateEmail) ? candidateEmail : undefined; if (directEmail) metrics.directEmails++;
      const validatedAuthorIdentity = Boolean(author.name && plausibleName(author.name) && (profileText || profileUrl || AUTHOR_ROLE.test(identitySearchEvidence)));
      if (!validatedAuthorIdentity) {
        const employerContact = extractEmployer(post.text + " " + post.discoveryText, directEmail, profileText, post.url); const employerEmail = directEmail?.toLowerCase(); const extractedRole = extractRole(post.text); const contactFreshnessValue = freshness(post.text); const contactFreshness = contactFreshnessValue === "unknown" ? freshness(post.discoveryText) : contactFreshnessValue;
        if (process.env.PUBLIC_HIRING_POST_DIAGNOSTICS === "true") console.error(JSON.stringify({ event: "public-hiring-post-candidate-gate", employerContact, extractedRole, contactFreshness, directEmail, postText: post.text.slice(0, 1800) }));
        if (employerContact.name && extractedRole.role && extractedRole.score >= 78 && contactFreshness !== "unknown") {
          metrics.employersExtracted++; metrics.validatedContacts++;
          const candidate: ProactiveRecruiterDiscoveryCandidate = { contactType: "EMPLOYER", recruiterName: "Employer recruiting contact", recruiterRole: "Employer recruiting contact", employer: employerContact.name, ...(employerContact.domain ? { employerDomain: normalizeDomain(employerContact.domain) } : {}), targetRoles: extractedRole.terms, roleMatchScore: extractedRole.score, hiringEvidenceScore: 85, overallConfidence: Math.min(100, extractedRole.score + 15), discoverySource: "public-web", discoveryUrl: post.url, discoveryEvidence: [post.text.slice(0, 3500), post.discoveryText.slice(0, 1200)].filter(Boolean), evidenceType: "job_hiring_evidence", evidenceDate: new Date().toISOString(), evidenceFreshness: contactFreshness, ...(employerEmail && employerContact.domain && usableDirectEmail(employerEmail, employerContact.domain) && hasRecruitingEmailEvidence(post.text, employerEmail) ? { email: employerEmail } : {}), emailStatus: "UNVERIFIED" };
          const key = canonicalIdentityKey(undefined, employerContact.name, post.url, employerEmail); const existing = candidates.get(key); if (existing) candidates.set(key, { ...existing, discoveryEvidence: [...new Set([...existing.discoveryEvidence, ...candidate.discoveryEvidence])].slice(0, 5) }); else candidates.set(key, candidate); continue;
        }
        metrics.rejectedPosts++; continue;
      }
      metrics.authorsExtracted++; const validatedAuthorName = author.name; if (!validatedAuthorName) { metrics.rejectedPosts++; continue; }
      if (!profileUrl || !profileText) { const profileSearch = await search(`site:linkedin.com/in "${validatedAuthorName}"`, runtimeSignal, input.fetchText); for (const result of profileSearch) { profileUrl = profileUrl ?? extractProfileUrlFromSearch(result.text, validatedAuthorName); profileText += " " + result.text; } }
      if (profileUrl && !profileText) profileText = clean(await (input.fetchText ? input.fetchText(profileUrl, runtimeSignal) : fetchText(profileUrl, runtimeSignal, 5000)) ?? "");
      const employer = extractEmployer(post.text + " " + post.discoveryText, directEmail, profileText); if (!employer.name) { metrics.rejectedPosts++; continue; } metrics.employersExtracted++;
      const identityEvidence = `${post.text} ${post.discoveryText} ${profileText}`; const explicitHiringContact = AUTHOR_ROLE.test(identityEvidence) || /(?:my team|our team|i['’]?m hiring|i am hiring|join (?:our|my) team|send (?:your|me your) resume|reach out to me|apply here|apply now)/i.test(post.text + " " + post.discoveryText); if (!explicitHiringContact) { metrics.rejectedPosts++; continue; }
      metrics.validatedIdentities++; const extractedRole = extractRole(post.text); const emailDomain = directEmail?.split("@")[1]?.toLowerCase(); const domain = employer.domain ?? emailDomain; const f = freshness(post.text); if (f === "unknown") { metrics.rejectedPosts++; continue; }
      const candidate: ProactiveRecruiterDiscoveryCandidate = { recruiterName: validatedAuthorName, recruiterRole: identityEvidence.match(AUTHOR_ROLE)?.[0] ?? "Hiring Lead", employer: employer.name, ...(domain ? { employerDomain: normalizeDomain(domain) } : {}), targetRoles: extractedRole.terms, roleMatchScore: extractedRole.score, hiringEvidenceScore: 85, overallConfidence: Math.min(100, extractedRole.score + (domain ? 10 : 0) + 5), discoverySource: "public-web", discoveryUrl: post.url, discoveryEvidence: [post.text.slice(0, 3500), profileText.slice(0, 1800)].filter(Boolean), evidenceType: "job_hiring_evidence", evidenceDate: new Date().toISOString(), evidenceFreshness: f, ...(usableDirectEmail(directEmail, employer.domain) ? { email: directEmail } : {}), emailStatus: "UNVERIFIED" };
      const key = canonicalIdentityKey(author.name, employer.name, post.url); const existing = candidates.get(key); if (existing) candidates.set(key, { ...existing, discoveryEvidence: [...new Set([...existing.discoveryEvidence, ...candidate.discoveryEvidence])].slice(0,5) }); else candidates.set(key, candidate);
    }
    for (const candidate of candidates.values()) {
      if (candidate.email || !candidate.employerDomain) continue;
      const q = `"${candidate.recruiterName}" "${candidate.employer}" "${candidate.employerDomain}" @${candidate.employerDomain}`; const results = await search(q, runtimeSignal); const emails = results.flatMap(r => [...new Set((r.text.match(EMAIL) ?? []).map(e => e.toLowerCase()))]);
      const found = emails.find(email => { const domain = email.split("@")[1]?.toLowerCase(); const local = email.split("@")[0] ?? ""; return domain === candidate.employerDomain?.toLowerCase() && recruiterEmailLocalPartMatchesName(candidate.recruiterName, local); });
      if (found) { candidate.email = found; candidate.emailStatus = "UNVERIFIED"; metrics.publiclyDiscoveredEmails++; }
    }
    return { candidates: [...candidates.values()], metrics };
  }
}
