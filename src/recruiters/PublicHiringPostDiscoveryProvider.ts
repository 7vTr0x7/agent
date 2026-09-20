import type { ProactiveRecruiterDiscoveryCandidate } from "./ProactiveRecruiterDiscoveryService";

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
}

export interface PublicHiringPostDiscoveryResult {
  candidates: ProactiveRecruiterDiscoveryCandidate[];
  metrics: PublicHiringPostDiscoveryMetrics;
}

export interface PublicHiringPostDiscoveryInput {
  targetRoles: string[];
  skills: string[];
  location?: string;
  preferredLocations?: string[];
  maxQueries?: number;
  signal?: AbortSignal;
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
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const POST_URL = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/(?:posts\/[^\s<>"']+|feed\/update\/urn:li:activity:\d+)/gi;
const PROFILE_URL = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const SEARCH_HOSTS = new Set(["google.com","www.google.com","bing.com","www.bing.com","duckduckgo.com","html.duckduckgo.com","startpage.com","www.startpage.com","search.yahoo.com","www.yahoo.com","search.brave.com","www.mojeek.com","qwant.com","www.qwant.com"]);

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
function profileFromPostUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    const slug = path.match(/^\/posts\/([^_/-]+(?:-[^_/-]+)*)_/i)?.[1];
    return slug ? `https://www.linkedin.com/in/${slug}` : undefined;
  } catch { return undefined; }
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
  const patterns = [
    /(?:<title[^>]*>|^|\n)[^\n<]{1,120}?\s+-\s+([A-Z][A-Za-z0-9&.' -]{2,80})\s+\|\s+LinkedIn/i,
    /(?:team|role|opportunity)\s+at\s+([A-Z][A-Za-z0-9&.' -]{2,80})/i,
    /\bat\s+([A-Z][A-Za-z0-9&.' -]{2,80}?)(?=\s+(?:in|for|as|is|are|and|on|with|from|-|—|\||,|\.|$))/i,
    /([A-Z][A-Za-z0-9&.' -]{2,80})\s+(?:is|are)\s+(?:hiring|looking for)/i
  ];
  let name: string | undefined;
  for (const p of patterns) {
    const m = haystack.match(p)?.[1]?.trim().replace(/[|•,.-]+$/, "").trim();
    if (m && m.length >= 3 && !/^(a|an|the|our|my|your|this|frontend|react|javascript|typescript)$/i.test(m)) { name = m; break; }
  }
  const emailDomain = email?.split("@")[1]?.toLowerCase();
  const urlDomains = [...haystack.matchAll(/https?:\/\/([^\s/<>"]+)/gi)]
    .map(m => normalizeDomain(m[1] ?? ""))
    .filter(d => d && !SEARCH_HOSTS.has(d) && !d.endsWith("linkedin.com"));
  const domain = emailDomain || urlDomains.find(d => !/^lnkd\.in$/i.test(d));
  if (!name && domain) name = domain.split(".")[0]?.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return name ? { name, ...(domain ? { domain } : {}) } : {};
}
function extractRole(text: string): { role?: string; score: number; terms: string[] } {
  const terms: string[] = [];
  let score = 0;
  for (const [label, pattern] of ROLE_PATTERNS) if (pattern.test(text)) { terms.push(label); score = Math.max(score, 75); }
  const skillHits = ["react","react.js","next.js","javascript","typescript","redux","node.js","express","graphql","mongodb","rest api","html","css"].filter(s => text.toLowerCase().includes(s));
  score = Math.min(100, score + Math.min(25, skillHits.length * 5));
  return { role: terms[0], score, terms };
}
function experienceCompatible(text: string): boolean {
  const ranges = [...text.matchAll(/(\d+)\s*(?:-|to|–|—)\s*(\d+)\s*years?/gi)];
  for (const m of ranges) if (Number(m[1]) > 3) return false;
  const minimums = [...text.matchAll(/(?:\b|\D)(\d+)\s*\+\s*years?/gi)];
  for (const m of minimums) if (Number(m[1]) > 3) return false;
  return true;
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
async function search(query: string, signal?: AbortSignal): Promise<Array<{ source: string; text: string }>> {
  const q = encodeURIComponent(query);
  const sources: Array<[string,string]> = [
    ["google", `https://r.jina.ai/https://www.google.com/search?q=${q}&gbv=1`],
    ["bing", `https://r.jina.ai/https://www.bing.com/search?q=${q}`],
    ["duckduckgo", `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${q}`],
    ["startpage", `https://r.jina.ai/https://www.startpage.com/sp/search?query=${q}`]
  ];
  const results: Array<{ source: string; text: string }> = [];
  for (const [source, url] of sources) {
    if (signal?.aborted) break;
    const text = await fetchText(url, signal);
    if (text) results.push({ source, text });
  }
  return results;
}
function extractPostUrls(text: string): string[] {
  return [...new Set([...text.matchAll(POST_URL)].map(m => canonicalUrl(m[0])))]
    .filter(url => /linkedin.com\/(?:posts\/|feed\/update\/urn:li:activity:)/i.test(url));
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
function canonicalIdentityKey(name: string, employer: string, postUrl: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}|${employer.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}|${canonicalUrl(postUrl)}`;
}

export class PublicHiringPostDiscoveryProvider {
  async discover(input: PublicHiringPostDiscoveryInput): Promise<PublicHiringPostDiscoveryResult> {
    const maxQueries = Math.max(1, Math.min(input.maxQueries ?? 8, 12));
    const roleTerms = input.targetRoles.length ? input.targetRoles.slice(0, 8) : ["Frontend Engineer","Frontend Developer","React Developer"];
    const queries = [
      ...roleTerms.slice(0, 4).map(role => `site:linkedin.com/posts "${role}" hiring React`),
      `site:linkedin.com/posts "we're hiring" "frontend" React`,
      `site:linkedin.com/posts "we are hiring" "frontend" React`,
      `site:linkedin.com/posts "my team is hiring" frontend React`,
      `site:linkedin.com/posts "send your resume" "frontend" React`,
      `site:linkedin.com/posts "looking for" "React Developer" Bangalore`,
      `site:linkedin.com/posts "Frontend Developer" "TypeScript" Bangalore`
    ].slice(0, maxQueries);

    const metrics: PublicHiringPostDiscoveryMetrics = {
      queriesGenerated: queries.length, queriesExecuted: 0, sourcePagesFetched: 0, publicPostUrls: 0,
      hiringIntentPosts: 0, relevantRolePosts: 0, employersExtracted: 0, authorsExtracted: 0,
      validatedIdentities: 0, directEmails: 0, publiclyDiscoveredEmails: 0, rejectedPosts: 0, duplicatePosts: 0, sourceStats: {}
    };
    const candidates = new Map<string, ProactiveRecruiterDiscoveryCandidate>();
    const postEvidence = new Map<string, { url: string; text: string; source: string }>();

    for (const query of queries) {
      if (input.signal?.aborted) break;
      metrics.queriesExecuted++;
      const results = await search(query, input.signal);
      for (const result of results) {
        metrics.sourcePagesFetched++;
        const stat = metrics.sourceStats[result.source] ?? (metrics.sourceStats[result.source] = { attempted:0,succeeded:0,empty:0,errors:0,posts:0 });
        stat.attempted++; stat.succeeded++;
        const urls = extractPostUrls(result.text);
        stat.posts += urls.length;
        for (const url of urls) {
          if (postEvidence.has(url)) { metrics.duplicatePosts++; continue; }
          const evidence = buildEvidence(result.text, url);
          if (!HIRING_INTENT.test(evidence)) continue;
          metrics.hiringIntentPosts++;
          const extractedRole = extractRole(evidence);
          if (!extractedRole.role || extractedRole.score < 75 || !experienceCompatible(evidence)) { metrics.rejectedPosts++; continue; }
          metrics.relevantRolePosts++;
          postEvidence.set(url, { url, text: evidence, source: result.source });
        }
      }
    }
    metrics.publicPostUrls = postEvidence.size;

    for (const post of postEvidence.values()) {
      if (input.signal?.aborted) break;
      const author = extractAuthor(post.text, post.url);
      if (!author.name || !plausibleName(author.name)) { metrics.rejectedPosts++; continue; }
      metrics.authorsExtracted++;
      const directEmail = extractDirectEmail(post.text);
      if (directEmail) metrics.directEmails++;
      let profileText = "";
      if (author.profileUrl) {
        profileText = clean(await fetchText(author.profileUrl, input.signal, 5000) ?? "");
        if (!profileText) {
          const profileSearch = await search(`site:linkedin.com/in "${author.name}" hiring recruiter`, input.signal);
          profileText = profileSearch.map(x => x.text).join(" ");
        }
      }
      const employer = extractEmployer(post.text, directEmail, profileText);
      if (!employer.name) { metrics.rejectedPosts++; continue; }
      metrics.employersExtracted++;
      const identityEvidence = `${post.text} ${profileText}`;
      if (!AUTHOR_ROLE.test(identityEvidence)) { metrics.rejectedPosts++; continue; }
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
        ...(directEmail ? { email: directEmail } : {}),
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
