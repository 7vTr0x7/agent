import type { ProactiveRecruiterDiscoveryCandidate } from "./ProactiveRecruiterDiscoveryService";
import { sourceList } from "./PublicSearchProviderRegistry";
import type { SourceId } from "./PublicSearchProviderRegistry";

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

const HIRING_INTENT = /(?:we['’]?re\s+hiring|we\s+are\s+hiring|my\s+team\s+is\s+hiring|we['’]?re\s+looking\s+for|we\s+are\s+looking\s+for|looking\s+for\s+(?:a|an)?\s*(?:frontend|front-end|react|next\.js|javascript|typescript|software|full[ -]?stack)\s*(?:developer|engineer|developers|engineers)|hiring\s+(?:for\s+)?(?:a\s+)?(?:frontend|front-end|react|next\.js|javascript|typescript|software|full[ -]?stack)|join\s+(?:our|my)\s+team|send\s+(?:your|me\s+your)\s+(?:resume|cv)|share\s+your\s+(?:resume|cv)|dm\s+(?:me|us)\s+(?:if|for)|reach\s+out\s+(?:with|to)|apply\s+(?:here|now)|referrals?\s+welcome|know\s+someone\s+who)/i;
const ROLE_PATTERNS: Array<[string, RegExp]> = [
  ["Frontend Engineer", /frontend\s+engineer|front-end\s+engineer/i],
  ["Frontend Developer", /frontend\s+developer|front-end\s+developer/i],
  ["React Developer", /react(?:\.js)?\s+developer|developer\s*[-|/]\s*react(?:\.js)?/i],
  ["React Engineer", /react(?:\.js)?\s+engineer/i],
  ["Next.js Developer", /next\.?js\s+developer/i],
  ["JavaScript Developer", /javascript\s+developer/i],
  ["TypeScript Developer", /typescript\s+developer/i],
  ["Software Engineer — Frontend", /software\s+engineer.{0,60}(?:frontend|front-end)|(?:frontend|front-end).{0,60}software\s+engineer/i],
  ["Full Stack Developer — React", /full[ -]?stack\s+developer.{0,80}react|react.{0,80}full[ -]?stack\s+developer/i],
  ["Full Stack Engineer — React", /full[ -]?stack\s+engineer.{0,80}react|react.{0,80}full[ -]?stack\s+engineer/i],
  ["Web Developer", /web\s+developer/i]
];
const AUTHOR_ROLE = /recruiter|recruiting|talent\s+acquisition|talent\s+partner|talent\s+advisor|technical\s+recruiter|engineering\s+recruiter|hiring\s+manager|human\s+resources|\bhr\b|people\s+(?:ops|operations|partner)|founder|co-founder|cofounder|hiring\s+lead|team\s+lead|engineering\s+manager/i;
const EXPLICIT_RECRUITING_ACTION = /(?:my|our)\s+team\s+is\s+hiring|\bi['’]?m\s+hiring\b|\bi\s+am\s+hiring\b|join\s+(?:my|our)\s+team|we['’]?re\s+hiring\s+at|we\s+are\s+hiring\s+at/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const POST_URL = /(?:https?:\/\/)?(?:www\.|[a-z]{2}\.)?linkedin\.com\/(?:posts\/[^\s<>"'\\)]+|feed\/update\/urn:li:activity:\d+)/gi;
const PROFILE_URL = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const SEARCH_HOSTS = new Set(["google.com","www.google.com","bing.com","www.bing.com","duckduckgo.com","html.duckduckgo.com","startpage.com","www.startpage.com","search.yahoo.com","www.yahoo.com","search.brave.com","www.mojeek.com","qwant.com","www.qwant.com"]);
const GENERIC_EMAIL_DOMAINS = new Set(["gmail.com","outlook.com","hotmail.com","yahoo.com","icloud.com","proton.me","protonmail.com"]);

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
  if (/^(the|we|our|my|team|hiring|frontend|react|software|developer|engineer)\b/i.test(v)) return false;
  const parts = v.split(" ");
  return parts.length >= 2 && parts.length <= 5 && parts.every(p => /^[A-Z][A-Za-z.'-]*$/.test(p));
}
function profileFromPostUrl(_url: string): string | undefined {
  // A post slug is not a reliable identity URL. Resolve the author's public
  // profile independently from indexed profile evidence instead of guessing.
  return undefined;
}
function extractAuthor(text: string, postUrl: string): { name?: string; profileUrl?: string } {
  const patterns = [
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})['’]s\s+(?:Post|post)\b/i,
    /#?(?:hiring|we.?re.?hiring)[^\n]{0,80}\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s*\b(?:posted|shared)/i,
    /(?:^|\n)([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s*[-|]\s*LinkedIn/i,
    /(?:^|\n)([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:2d|3d|4d|5d|6d|1w|2w|3w|4w|1mo|2mo|3mo|4mo|5mo|6mo)\b/i
  ];
  for (const pattern of patterns) {
    const name = text.match(pattern)?.[1]?.trim();
    if (name && plausibleName(name)) return { name, profileUrl: profileFromPostUrl(postUrl) };
  }
  const profileUrl = profileFromPostUrl(postUrl);
  const slugName = profileUrl?.split("/in/")[1]?.replace(/[-_]+/g, " ");
  if (slugName) {
    const name = slugName.split(" ").map(p => p ? p.charAt(0).toUpperCase()+p.slice(1) : p).join(" ");
    if (plausibleName(name)) return { name, profileUrl };
  }
  return { profileUrl };
}
function extractEmployer(text: string, email?: string, profileText?: string): { name?: string; domain?: string } {
  const haystack = [text, profileText ?? ""].join(" ");
  const emailDomain = email?.split("@")[1]?.toLowerCase();
  const strongAt = haystack.match(/\bat\s+([A-Z][A-Za-z0-9&.' -]{2,80})(?=\s*[.!?](?:\s|$)|\s+(?:Location|Experience|Skills?)\s*:|$)/i)?.[1]?.trim();
  const linkedinEmployer = haystack.match(/(?:^|\n)[^\n]{1,120}?\s+-\s+([A-Z][A-Za-z0-9&.' -]{2,80})\s+\|\s+LinkedIn/i)?.[1]?.trim();
  const hiringEmployer = haystack.match(/([A-Z][A-Za-z0-9&.' -]{2,80})\s+(?:is|are)\s+(?:hiring|looking for)/i)?.[1]?.trim();
  let name = strongAt || linkedinEmployer || hiringEmployer;
  const urlDomains = [...haystack.matchAll(/https?:\/\/([^\s/<>"']+)/gi)]
    .map(m => normalizeDomain(m[1] ?? ""))
    .filter(d => d && !SEARCH_HOSTS.has(d) && !d.endsWith("linkedin.com"));
  const domain = emailDomain || urlDomains.find(d => d && !/^lnkd\.in$/i.test(d));
  if (!name && domain) name = domain.split(".")[0]?.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  if (name && domain) return { name: name.replace(/[|•,.-]+$/, "").trim(), domain };
  if (name) return { name: name.replace(/[|•,.-]+$/, "").trim() };
  return {};
}
function extractRole(text: string): { role?: string; score: number; terms: string[] } {
  const terms: string[] = [];
  let score = 0;
  for (const [label, pattern] of ROLE_PATTERNS) if (pattern.test(text)) { terms.push(label); score = Math.max(score, 75); }
  const skillHits = ["react","react.js","next.js","javascript","typescript","redux","node.js","express","graphql","mongodb","rest api","html","css"].filter(s => text.toLowerCase().includes(s));
  score = Math.min(100, score + Math.min(25, skillHits.length * 5));
  return { role: terms[0], score, terms };
}
function experienceCompatible(text: string, candidateYears = 3): boolean {
  const ranges = [...text.matchAll(/(\d+)\s*(?:-|to|–|—)\s*(\d+)\s*years?/gi)];
  for (const m of ranges) {
    const min = Number(m[1]);
    const max = Number(m[2]);
    if (candidateYears < min || candidateYears > max) return false;
  }
  const minimums = [...text.matchAll(/(?:\b|\D)(\d+)\s*\+\s*years?/gi)];
  for (const m of minimums) if (candidateYears < Number(m[1])) return false;
  return true;
}
function usableDirectEmail(email: string | undefined, employerDomain?: string): boolean {
  if (!email) return false;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || GENERIC_EMAIL_DOMAINS.has(domain)) return false;
  return !employerDomain || domain === employerDomain.toLowerCase();
}

function extractDirectEmail(text: string): string | undefined {
  const found = [...new Set((text.match(EMAIL) ?? []).map(v => v.toLowerCase()))];
  return found.find(e => !/^(noreply|no-reply)@/i.test(e));
}
async function fetchText(url: string, signal?: AbortSignal, timeoutMs = 6500): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept: "text/html,text/plain,*/*;q=0.8", "user-agent": "Mozilla/5.0 (compatible; job-agent-public-hiring-posts/1.0)" } });
    if (!response.ok) return null;
    return await response.text();
  } catch { return null; }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
}

async function search(query: string, signal?: AbortSignal, fetchTextOverride?: (url: string, signal?: AbortSignal, headers?: Record<string,string>) => Promise<string | null>): Promise<Array<{ source: SourceId; text: string }>> {
  const results: Array<{ source: SourceId; text: string }> = [];
  for (const provider of sourceList(query)) {
    if (signal?.aborted) break;
    const text = await (fetchTextOverride ? fetchTextOverride(provider.url, signal, provider.headers) : fetchText(provider.url, signal));
    if (text) results.push({ source: provider.id, text });
  }
  return results;
}

function extractPublicEvidenceUrls(text: string): string[] {
  const urls = [...new Set((text.match(/https?:\/\/[^\s<>"')\]]+/gi) ?? []).map(canonicalUrl))];
  return urls.filter(url => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      return !SEARCH_HOSTS.has(host) && host !== "r.jina.ai" && !host.endsWith("linkedin.com/jobs") && !/^\/in\//i.test(parsed.pathname);
    } catch { return false; }
  });
}

function extractProfileUrlFromSearch(text: string, name: string): string | undefined {
  const urls = [...new Set((text.match(PROFILE_URL) ?? []).map(canonicalUrl))];
  const tokens = name.toLowerCase().split(/\\s+/).filter(Boolean);
  return urls.find(url => tokens.length >= 2 && tokens.every(token => url.toLowerCase().includes(token.replace(/[^a-z0-9-]/g, ""))));
}
function extractProfileUrls(text: string): string[] {
  return [...new Set((text.match(PROFILE_URL) ?? []).map(canonicalUrl))]
    .filter(url => !/\/pub\/dir\//i.test(url));
}
function extractProfileName(profileText: string, profileUrl: string): string | undefined {
  const title = profileText.match(/(?:^|<title>)\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+-\s+/i)?.[1];
  if (title && plausibleName(title)) return title.trim();
  try {
    const slug = new URL(profileUrl).pathname.match(/^\/in\/([^/?#]+)/i)?.[1];
    const name = slug?.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    if (name && plausibleName(name)) return name;
  } catch {}
  return undefined;
}
function extractHiringSnippets(profileText: string): string[] {
  const text = clean(profileText);
  const re = new RegExp(HIRING_INTENT.source, "gi");
  const snippets: string[] = [];
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    const snippet = text.slice(Math.max(0, index - 1000), Math.min(text.length, index + 3500)).trim();
    if (snippet && !snippets.includes(snippet)) snippets.push(snippet);
  }
  return snippets.slice(0, 8);
}
function buildEvidence(text: string, postUrl: string): string {
  const i = text.toLowerCase().indexOf(postUrl.toLowerCase());
  return (i >= 0 ? text.slice(Math.max(0, i - 1400), Math.min(text.length, i + 5000)) : text.slice(0, 5000)).replace(/\s+/g, " ").trim().slice(0, 6000);
}
function freshness(evidence: string): ProactiveRecruiterDiscoveryCandidate["evidenceFreshness"] {
  if (/\b(?:today|1d|2d|3d|4d|5d|6d|1w|2w|3w|4w|1mo|2mo|3mo|4mo)\b/i.test(evidence)) return "current";
  if (/\b(?:5mo|6mo|7mo|8mo|9mo|10mo|11mo|12mo)\b/i.test(evidence)) return "recent";
  return "unknown";
}
function canonicalIdentityKey(name: string, employer: string, _evidenceKey: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}|${employer.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}`;
}

export class PublicHiringPostDiscoveryProvider {
  async discover(input: PublicHiringPostDiscoveryInput): Promise<PublicHiringPostDiscoveryResult> {
    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 8, 12));
    const roleTerms = input.targetRoles.length ? input.targetRoles.slice(0, 8) : ["Frontend Engineer","Frontend Developer","React Developer"];
    const queries = [
      ...roleTerms.slice(0, 4).map(role => `"${role}" hiring React`),
      `"we're hiring" "frontend" React`,
      `"we are hiring" "frontend" React`,
      `"my team is hiring" frontend React`,
      `"send your resume" "frontend" React`,
      `"looking for" "React Developer" Bangalore`,
      `"Frontend Developer" "TypeScript" Bangalore`
    ].slice(0, maxQueries);

    const profileQueries = [
      'site:linkedin.com/in "we\'re hiring" "frontend developer" Bangalore',
      'site:linkedin.com/in "we are hiring" React Bangalore',
      'site:linkedin.com/in "my team is hiring" React India',
      'site:linkedin.com/in "share your resume" React Bengaluru'
    ];
    const metrics: PublicHiringPostDiscoveryMetrics = {
      queriesGenerated: queries.length + profileQueries.length, queriesExecuted: 0, sourcePagesFetched: 0, publicPostUrls: 0,
      configuredProviders: 0, eligibleProviders: 0, executedProviders: 0, skippedProviders: 0, providerFailures: 0, providerRateLimited: 0, providerBlocked: 0, providerTimeouts: 0, rawSearchResults: 0, normalizedResults: 0, deduplicatedResults: 0,
      hiringIntentPosts: 0, relevantRolePosts: 0, employersExtracted: 0, authorsExtracted: 0,
      validatedIdentities: 0, directEmails: 0, publiclyDiscoveredEmails: 0, rejectedPosts: 0, duplicatePosts: 0, sourceStats: {}
    };
    const candidates = new Map<string, ProactiveRecruiterDiscoveryCandidate>();
    const configuredProviderIds = new Set<string>();
    const postEvidence = new Map<string, { url: string; text: string; source: string }>();

    for (const query of queries) {
      if (input.signal?.aborted) break;
      metrics.queriesExecuted++;
      const providersForQuery = sourceList(query);
      for (const provider of providersForQuery) configuredProviderIds.add(provider.id);
      const results = await search(query, input.signal, input.fetchText);
      for (const result of results) {
        metrics.sourcePagesFetched++;
        metrics.rawSearchResults += (result.text.match(/https?:\/\/[^\s<>"'\\)\\]]+/gi) ?? []).length;
        const stat = metrics.sourceStats[result.source] ?? (metrics.sourceStats[result.source] = { attempted:0,succeeded:0,empty:0,errors:0,posts:0 });
        stat.attempted++; stat.succeeded++;
        const urls = extractPublicEvidenceUrls(result.text);
        metrics.normalizedResults += urls.length;
        stat.posts += urls.length;
        for (const url of urls) {
          if (postEvidence.has(url)) { metrics.duplicatePosts++; metrics.deduplicatedResults++; continue; }
          const evidence = buildEvidence(clean(result.text), url);
          if (!HIRING_INTENT.test(evidence)) continue;
          metrics.hiringIntentPosts++;
          const extractedRole = extractRole(evidence);
          if (!extractedRole.role || extractedRole.score < 75 || !experienceCompatible(evidence, input.yearsExperience ?? 3)) { metrics.rejectedPosts++; continue; }
          metrics.relevantRolePosts++;
          postEvidence.set(url, { url, text: evidence, source: result.source });
        }
      }
    }
    metrics.configuredProviders = configuredProviderIds.size;
    metrics.eligibleProviders = configuredProviderIds.size;
    metrics.executedProviders = configuredProviderIds.size;
    metrics.providerFailures = Math.max(0, metrics.eligibleProviders - metrics.executedProviders);

    // Public LinkedIn profile pages are a supported indexed-public source. They often expose
    // the author's recent posts even when search engines do not expose the individual post URL.
    for (const query of profileQueries) {
      if (input.signal?.aborted) break;
      const results = await search(query, input.signal, input.fetchText);
      for (const result of results) {
        metrics.sourcePagesFetched++;
        const profileUrls = extractProfileUrls(result.text);
        for (const profileUrl of profileUrls) {
          if (profileUrl.includes("/pub/dir/")) continue;
          const profileText = clean(await (input.fetchText ? input.fetchText(profileUrl, input.signal) : fetchText(profileUrl, input.signal, 6500)) ?? "");
          if (!profileText) continue;
          const authorName = extractProfileName(profileText, profileUrl);
          if (!authorName) continue;
          const snippets = extractHiringSnippets(profileText);
          for (const snippet of snippets) {
            const role = extractRole(snippet);
            if (!role.role || role.score < 75 || !experienceCompatible(snippet, input.yearsExperience ?? 3)) continue;
            metrics.hiringIntentPosts++;
            metrics.relevantRolePosts++;
            const directEmail = extractDirectEmail(snippet);
            if (directEmail) metrics.directEmails++;
            const employer = extractEmployer(profileText, directEmail, profileText);
            if (!employer.name) continue;
            metrics.employersExtracted++;
            const explicitAction = EXPLICIT_RECRUITING_ACTION.test(snippet);
            if (!AUTHOR_ROLE.test(profileText) && !explicitAction) continue;
            metrics.authorsExtracted++;
            metrics.validatedIdentities++;
            const key = canonicalIdentityKey(authorName, employer.name, profileUrl + "|" + snippet.slice(0, 220));
            if (candidates.has(key)) { metrics.duplicatePosts++; continue; }
            candidates.set(key, {
              recruiterName: authorName,
              recruiterRole: AUTHOR_ROLE.test(profileText) ? (profileText.match(AUTHOR_ROLE)?.[0] ?? "Hiring Lead") : "Hiring Lead",
              employer: employer.name,
              ...(employer.domain ? { employerDomain: employer.domain } : {}),
              targetRoles: role.terms,
              roleMatchScore: role.score,
              hiringEvidenceScore: 90,
              overallConfidence: Math.min(100, role.score + (employer.domain ? 10 : 0) + 5),
              discoverySource: "public-web",
              discoveryUrl: profileUrl,
              discoveryEvidence: [snippet.slice(0, 5000), profileText.slice(0, 1800)].filter(Boolean),
              evidenceType: "job_hiring_evidence",
              evidenceDate: new Date().toISOString(),
              evidenceFreshness: freshness(snippet),
              ...(usableDirectEmail(directEmail, employer.domain) ? { email: directEmail } : {}),
              emailStatus: "UNVERIFIED"
            });
            metrics.publicPostUrls++;
          }
        }
      }
    }

    metrics.publicPostUrls = Math.max(metrics.publicPostUrls, postEvidence.size);

    for (const post of postEvidence.values()) {
      if (input.signal?.aborted) break;
      const author = extractAuthor(post.text, post.url);
      if (!author.name || !plausibleName(author.name)) { metrics.rejectedPosts++; continue; }
      metrics.authorsExtracted++;
      const directEmail = extractDirectEmail(post.text);
      if (directEmail) metrics.directEmails++;
      let profileText = "";
      let profileUrl = author.profileUrl;
      if (!profileUrl || !profileText) {
        const profileSearch = await search(`site:linkedin.com/in "${author.name}"`, input.signal, input.fetchText);
        for (const result of profileSearch) {
          profileUrl = profileUrl ?? extractProfileUrlFromSearch(result.text, author.name);
          profileText += " " + result.text;
        }
      }
      if (profileUrl && !profileText) profileText = clean(await (input.fetchText ? input.fetchText(profileUrl, input.signal) : fetchText(profileUrl, input.signal, 5000)) ?? "");
      const employer = extractEmployer(post.text, directEmail, profileText);
      if (!employer.name) { metrics.rejectedPosts++; continue; }
      metrics.employersExtracted++;
      const identityEvidence = `${post.text} ${profileText}`;
      const explicitHiringContact = AUTHOR_ROLE.test(identityEvidence) ||
        /(?:my team|our team|i['’]?m hiring|i am hiring|join (?:our|my) team|send (?:your|me your) resume|reach out to me|apply here|apply now)/i.test(post.text);
      if (!explicitHiringContact) { metrics.rejectedPosts++; continue; }
      metrics.validatedIdentities++;
      const extractedRole = extractRole(post.text);
      const emailDomain = directEmail?.split("@")[1]?.toLowerCase();
      const domain = employer.domain ?? emailDomain;
      const f = freshness(post.text);
      const candidate: ProactiveRecruiterDiscoveryCandidate = {
        recruiterName: author.name,
        recruiterRole: identityEvidence.match(AUTHOR_ROLE)?.[0] ?? "Hiring Lead",
        employer: employer.name,
        ...(domain ? { employerDomain: normalizeDomain(domain) } : {}),
        targetRoles: extractedRole.terms,
        roleMatchScore: extractedRole.score,
        hiringEvidenceScore: 85,
        overallConfidence: Math.min(100, extractedRole.score + (domain ? 10 : 0) + 5),
        discoverySource: "public-web",
        discoveryUrl: post.url,
        discoveryEvidence: [post.text.slice(0, 3500), profileText.slice(0, 1800)].filter(Boolean),
        evidenceType: "job_hiring_evidence",
        evidenceDate: new Date().toISOString(),
        evidenceFreshness: f,
        ...(usableDirectEmail(directEmail, employer.domain) ? { email: directEmail } : {}),
        emailStatus: "UNVERIFIED"
      };
      const key = canonicalIdentityKey(author.name, employer.name, post.url);
      const existing = candidates.get(key);
      if (existing) {
        candidates.set(key, { ...existing, discoveryEvidence: [...new Set([...existing.discoveryEvidence, ...candidate.discoveryEvidence])].slice(0,5) });
      } else candidates.set(key, candidate);
    }

    // A direct public email is preferred. If no email was printed in the post,
    // perform a bounded exact-name/domain search. The address is accepted only
    // when it is publicly present and the local part contains the author's name.
    for (const candidate of candidates.values()) {
      if (candidate.email || !candidate.employerDomain) continue;
      const q = `"${candidate.recruiterName}" "${candidate.employer}" "${candidate.employerDomain}" @${candidate.employerDomain}`;
      const results = await search(q, input.signal);
      const emails = results.flatMap(r => [...new Set((r.text.match(EMAIL) ?? []).map(e => e.toLowerCase()))]);
      const nameTokens = candidate.recruiterName.toLowerCase().split(/\s+/).filter(Boolean);
      const found = emails.find(email => {
        const local = email.split("@")[0] ?? "";
        return email.endsWith(`@${candidate.employerDomain}`) && nameTokens.length >= 2 && nameTokens.every(token => local.includes(token.replace(/[^a-z]/g,"")));
      });
      if (found) {
        candidate.email = found;
        candidate.emailStatus = "UNVERIFIED";
        metrics.publiclyDiscoveredEmails++;
      }
    }

    return { candidates: [...candidates.values()], metrics };
  }
}
