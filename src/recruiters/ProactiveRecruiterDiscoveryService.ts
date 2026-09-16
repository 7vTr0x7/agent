import { ProactiveRecruiterRoleMatcher, CandidateProfileLike } from "./ProactiveRecruiterRoleMatcher";
import { RecruiterVerificationEvidence } from "./RecruiterDiscovery";

export interface ProactiveRecruiterDiscoveryCandidate {
  recruiterName: string;
  recruiterRole: string;
  employer: string;
  employerDomain?: string;
  targetRoles: string[];
  roleMatchScore: number;
  hiringEvidenceScore: number;
  overallConfidence: number;
  discoverySource: "public-web";
  discoveryUrl: string;
  discoveryEvidence: string[];
  evidenceType: "public_profile" | "job_hiring_evidence";
  evidenceDate: string;
  evidenceFreshness: "current" | "recent" | "historical" | "unknown";
  email?: string;
  emailStatus: "VERIFIED" | "LIKELY" | "UNVERIFIED" | "INVALID";
  verificationEvidence?: RecruiterVerificationEvidence[];
}

export interface ProactiveRecruiterDiscoveryMetrics {
  queriesGenerated: number;
  queriesExecuted: number;
  queriesSucceeded: number;
  queriesFailed: number;
  responsesEmpty: number;
  rawSearchResults: number;
  urlsExtracted: number;
  linkedinUrlsExtracted: number;
  publicProfileUrlsExtracted: number;
  profileFetchAttempts: number;
  profilesFetched: number;
  profilesFetchFailures: number;
  profilesParsed: number;
  profilesParseFailures: number;
  recruiterRoleMatches: number;
  recruiterEvidenceMatches: number;
  companyValidated: number;
  identityValidated: number;
  relevanceAccepted: number;
  hiringEvidenceAccepted: number;
  hiringCurrent: number;
  hiringRecent: number;
  hiringHistorical: number;
  hiringUnknown: number;
  duplicates: number;
  finalDiscovered: number;
  rejectionReasons: Record<string, number>;
  sourceStats: Record<string, {
    attempted: number;
    succeeded: number;
    empty: number;
    timeouts: number;
    http403: number;
    http429: number;
    http5xx: number;
    otherHttpErrors: number;
    rawResults: number;
    urls: number;
    candidates: number;
    duplicates: number;
  }>;
}

export interface ProactiveRecruiterDiscoveryOptions {
  fetchText?: (url: string, signal?: AbortSignal, headers?: Record<string, string>) => Promise<string | null>;
  now?: () => Date;
  maxQueries?: number;
  targetCandidates?: number;
  signal?: AbortSignal;
}

type SourceId =
  | "google-jina" | "bing-jina" | "duckduckgo-jina" | "startpage-jina" | "ecosia-jina"
  | "jina-search" | "brave-api" | "mojeek-api" | "brave-direct" | "mojeek-direct"
  | "qwant-direct" | "yahoo-direct";
interface Source { id: SourceId; url: string; headers?: Record<string, string>; }
interface FetchResult { text: string | null; status?: number; timedOut?: boolean; }

const SEARCH_CONCURRENCY = 4;
const PROFILE_CONCURRENCY = 4;
const TIMEOUT = 8000;
const RETRIES = 2;
const JINA_READER_GAP_MS = 3100;
const DEFAULT_MAX_QUERIES = 18;
const DEFAULT_TARGET_CANDIDATES = 8;
const GENERIC_EMAIL_DOMAINS = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com"]);
const CURRENT_HIRING_EVIDENCE = /currently hiring|actively hiring|hiring now|we(?:'re| are) hiring|open roles|open positions|urgent hiring|immediate hiring|hiring for|looking for .* (?:engineers?|developers?|talent)/i;
const RECENT_HIRING_EVIDENCE = /last week|last month|recently|recent hiring|2026|2025|\b\d+\s*(?:days?|weeks?|months?)\s*ago/i;
const RECRUITING = /(recruiter|recruiting|talent acquisition|talent partner|talent sourcer|technical sourcer|hiring manager|human resources|\bhr\b|staffing|hiring|recruitment)/i;
const NON_RECRUITING = /(customer support|technical support|sales|billing|privacy|legal|security|press|media|partnerships?|helpdesk|procurement|accounting|finance|customer success|marketing)/i;
const LI_PROFILE = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+(?:[/?#][^\s<>)]*)?/gi;
const URL_PATTERN = /https?:\/\/[^\s<>\]\[()"']+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PROFILE_PATH = /\/(?:in|talent|people|person|profile|profiles|team|staff|experts?|consultants?|recruiters?)\//i;
const FRONTEND_ROLE_TERMS = /(frontend|front-end|react(?:\.js|js)?|next(?:\.js|js)?|javascript|typescript|ui engineer|ui developer|web developer|full stack|full-stack|mern)/i;
const SEARCH_HOSTS = new Set(["google.com", "www.google.com", "bing.com", "www.bing.com", "duckduckgo.com", "html.duckduckgo.com", "startpage.com", "www.startpage.com", "ecosia.org", "www.ecosia.org", "qwant.com", "www.qwant.com", "search.yahoo.com", "search.brave.com", "www.mojeek.com"]);
let jinaReaderNextAt = 0;

const emptyMetrics = (): ProactiveRecruiterDiscoveryMetrics => ({
  queriesGenerated: 0,
  queriesExecuted: 0,
  queriesSucceeded: 0,
  queriesFailed: 0,
  responsesEmpty: 0,
  rawSearchResults: 0,
  urlsExtracted: 0,
  linkedinUrlsExtracted: 0,
  publicProfileUrlsExtracted: 0,
  profileFetchAttempts: 0,
  profilesFetched: 0,
  profilesFetchFailures: 0,
  profilesParsed: 0,
  profilesParseFailures: 0,
  recruiterRoleMatches: 0,
  recruiterEvidenceMatches: 0,
  companyValidated: 0,
  identityValidated: 0,
  relevanceAccepted: 0,
  hiringEvidenceAccepted: 0,
  hiringCurrent: 0,
  hiringRecent: 0,
  hiringHistorical: 0,
  hiringUnknown: 0,
  duplicates: 0,
  finalDiscovered: 0,
  rejectionReasons: {},
  sourceStats: {}
});

const DEFAULT_FETCH = async (url: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<FetchResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        accept: "application/json,text/plain,text/html,application/xhtml+xml,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 (compatible; job-agent-proactive-recruiter/9.0)",
        ...(headers ?? {})
      }
    });
    return { text: response.ok ? await response.text() : null, status: response.status };
  } catch (error) {
    return { text: null, timedOut: error instanceof Error && error.name === "AbortError" };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
};

const stripHtml = (value: string): string => value
  .replace(/<((?:https?:\/\/)[^>]+)>/gi, " $1 ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#64;|&#x40;/gi, "@")
  .replace(/&#46;|&#x2e;/gi, ".")
  .replace(/\s+/g, " ")
  .trim();
const decodeUrl = (value: string): string => value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/\\u0026/gi, "&");
const canonicalUrl = (value: string): string => {
  try {
    const url = new URL(decodeUrl(value).replace(/[.,;]+$/, ""));
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "trk", "trackingId", "refId", "lipi"].forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch {
    return decodeUrl(value).replace(/[.,;]+$/, "").replace(/\/+$/, "");
  }
};
const canonicalLinkedIn = (value: string): string => {
  try {
    const url = new URL(value);
    const profile = url.pathname.match(/^\/in\/([^/?#]+)/i)?.[1];
    return profile ? `https://www.linkedin.com/in/${profile.toLowerCase()}` : canonicalUrl(value);
  } catch {
    return value.toLowerCase().replace(/\/+$/, "");
  }
};

const sourceList = (query: string): Source[] => {
  const q = encodeURIComponent(query);
  const sources: Source[] = [
    { id: "google-jina", url: `https://r.jina.ai/https://www.google.com/search?q=${q}&gbv=1` },
    { id: "bing-jina", url: `https://r.jina.ai/https://www.bing.com/search?q=${q}` },
    { id: "duckduckgo-jina", url: `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${q}` },
    { id: "startpage-jina", url: `https://r.jina.ai/https://www.startpage.com/sp/search?query=${q}` },
    { id: "ecosia-jina", url: `https://r.jina.ai/https://www.ecosia.org/search?q=${q}` },
    { id: "brave-direct", url: `https://search.brave.com/search?q=${q}&source=web` },
    { id: "mojeek-direct", url: `https://www.mojeek.com/search?q=${q}` },
    { id: "qwant-direct", url: `https://www.qwant.com/?q=${q}&t=web` },
    { id: "yahoo-direct", url: `https://search.yahoo.com/search?p=${q}` }
  ];
  if (process.env.JINA_API_KEY?.trim()) sources.push({ id: "jina-search", url: `https://s.jina.ai/${q}`, headers: { authorization: `Bearer ${process.env.JINA_API_KEY.trim()}` } });
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) sources.push({ id: "brave-api", url: `https://api.search.brave.com/res/v1/web/search?q=${q}&count=20&extra_snippets=true`, headers: { "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY.trim(), accept: "application/json" } });
  if (process.env.MOJEEK_API_KEY?.trim()) sources.push({ id: "mojeek-api", url: `https://api.mojeek.com/search?q=${q}&api_key=${encodeURIComponent(process.env.MOJEEK_API_KEY.trim())}&fmt=json&t=20`, headers: { accept: "application/json" } });
  return sources;
};
const isJinaReader = (id: SourceId): boolean => ["google-jina", "bing-jina", "duckduckgo-jina", "startpage-jina", "ecosia-jina"].includes(id);
const statFor = (metrics: ProactiveRecruiterDiscoveryMetrics, id: SourceId) => metrics.sourceStats[id] ?? (metrics.sourceStats[id] = { attempted: 0, succeeded: 0, empty: 0, timeouts: 0, http403: 0, http429: 0, http5xx: 0, otherHttpErrors: 0, rawResults: 0, urls: 0, candidates: 0, duplicates: 0 });
const reject = (metrics: ProactiveRecruiterDiscoveryMetrics, reason: string): void => { metrics.rejectionReasons[reason] = (metrics.rejectionReasons[reason] ?? 0) + 1; };

async function fetchSource(source: Source, fetcher: ProactiveRecruiterDiscoveryOptions["fetchText"], signal: AbortSignal | undefined, metrics: ProactiveRecruiterDiscoveryMetrics): Promise<string | null> {
  const stats = statFor(metrics, source.id);
  stats.attempted += 1;
  metrics.queriesExecuted += 1;
  let emptyResponse = false;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (signal?.aborted) return null;
    if (!fetcher && isJinaReader(source.id) && !process.env.JINA_API_KEY?.trim()) {
      const wait = Math.max(0, jinaReaderNextAt - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      jinaReaderNextAt = Date.now() + JINA_READER_GAP_MS;
    }
    const result = fetcher ? { text: await fetcher(source.url, signal, source.headers), status: 200 } : await DEFAULT_FETCH(source.url, signal, source.headers);
    if (result.text) {
      stats.succeeded += 1;
      metrics.queriesSucceeded += 1;
      return result.text;
    }
    if (result.status === undefined || (result.status >= 200 && result.status < 300)) emptyResponse = true;
    if (result.timedOut) stats.timeouts += 1;
    if (result.status === 403) stats.http403 += 1;
    else if (result.status === 429) stats.http429 += 1;
    else if ((result.status ?? 0) >= 500) stats.http5xx += 1;
    else if ((result.status ?? 0) >= 400) stats.otherHttpErrors += 1;
    if (attempt === RETRIES || (!result.timedOut && result.status !== undefined && ![408, 425, 429].includes(result.status) && result.status < 500)) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 250 * (2 ** attempt) + Math.floor(Math.random() * 200))));
  }
  if (emptyResponse) {
    stats.empty += 1;
    metrics.responsesEmpty += 1;
  }
  metrics.queriesFailed += 1;
  return null;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export class ProactiveRecruiterDiscoveryService {
  private readonly matcher = new ProactiveRecruiterRoleMatcher();
  private readonly fetchText?: ProactiveRecruiterDiscoveryOptions["fetchText"];
  private readonly now: () => Date;
  private readonly maxQueries: number;
  private readonly targetCandidates: number;
  private readonly signal?: AbortSignal;
  private lastMetrics: ProactiveRecruiterDiscoveryMetrics = emptyMetrics();

  constructor(options: ProactiveRecruiterDiscoveryOptions = {}) {
    this.fetchText = options.fetchText;
    this.now = options.now ?? (() => new Date());
    this.maxQueries = Math.max(1, options.maxQueries ?? (Number(process.env.PROACTIVE_RECRUITER_MAX_QUERIES) || DEFAULT_MAX_QUERIES));
    this.targetCandidates = Math.max(1, options.targetCandidates ?? (Number(process.env.PROACTIVE_RECRUITER_TARGET_CANDIDATES) || DEFAULT_TARGET_CANDIDATES));
    this.signal = options.signal;
  }

  getLastRunMetrics(): ProactiveRecruiterDiscoveryMetrics { return this.lastMetrics; }

  buildQueries(profile: CandidateProfileLike): string[] {
    const roles = this.matcher.buildTargetTerms(profile).filter((term) => term.length >= 4);
    const explicitRole = profile.targetRoles?.find((term) => term.trim().length >= 4)?.trim();
    const role = explicitRole ?? roles.find((term) => /frontend|react|next|javascript|typescript|full stack|web/.test(term)) ?? roles[0] ?? "frontend developer";
    const locations = [...new Set((profile.preferredLocations ?? []).map((value) => value.trim()).filter(Boolean))];
    const locationTerms = locations.length ? locations.slice(0, 3) : ["India"];
    const tech = [...new Set((profile.skills ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 4);
    const techTerms = tech.length ? tech.slice(0, 2).map((value) => `"${value}"`).join(" ") : `"${role}"`;
    const queries = [
      `site:linkedin.com/in "technical recruiter" "${role}" "${locationTerms[0]}"`,
      `site:linkedin.com/in "talent acquisition" "${role}" "${locationTerms[0]}"`,
      `site:linkedin.com/in "engineering recruiter" "${role}" "${locationTerms[0]}"`,
      `site:linkedin.com/in recruiter "${role}" "${locationTerms[0]}"`,
      `site:linkedin.com/in recruiter ${techTerms} "${locationTerms[0]}"`,
      `site:linkedin.com/posts recruiter ${techTerms} hiring "${locationTerms[0]}"`,
      `site:linkedin.com/jobs "${role}" recruiter "${locationTerms[0]}"`,
      `site:hirist.tech/r "technical recruiter" ${techTerms} "${locationTerms[0]}"`,
      `site:stackforce.co/talent "technical recruiter" ${techTerms} "${locationTerms[0]}"`,
      `"technical recruiter" ${techTerms} "${locationTerms[0]}" email`,
      `"talent acquisition" ${techTerms} "${locationTerms[0]}" email`,
      `"engineering recruiter" "${role}" India email`,
      `"recruiter" "${role}" "${locationTerms[0]}" hiring email`,
      `"technical recruiter" React Bengaluru hiring`,
      `"technical recruiter" React Bangalore hiring`,
      `"frontend engineer" recruiter India hiring`,
      `"Next.js" recruiter India hiring`,
      `"React" "talent partner" India hiring`
    ];
    for (const location of locationTerms.slice(1)) {
      queries.push(`"${role}" recruiter "${location}"`, `"technical recruiter" ${techTerms} "${location}"`);
    }
    return [...new Set(queries)].slice(0, this.maxQueries);
  }

  async discover(profile: CandidateProfileLike): Promise<ProactiveRecruiterDiscoveryCandidate[]> {
    const metrics = emptyMetrics();
    this.lastMetrics = metrics;
    const queries = this.buildQueries(profile);
    metrics.queriesGenerated = queries.length;
    const candidates = new Map<string, ProactiveRecruiterDiscoveryCandidate>();

    for (const query of queries) {
      if (this.signal?.aborted || candidates.size >= this.targetCandidates) break;
      const sources = sourceList(query);
      const pages = (await mapWithConcurrency(sources, SEARCH_CONCURRENCY, async (source) => ({
        source,
        text: await fetchSource(source, this.fetchText, this.signal, metrics)
      }))).filter((item): item is { source: Source; text: string } => Boolean(item.text));

      for (const { source, text: raw } of pages) {
        if (this.signal?.aborted || candidates.size >= this.targetCandidates) break;
        const normalized = stripHtml(raw);
        const stats = statFor(metrics, source.id);
        const urls = [...new Set((normalized.match(URL_PATTERN) ?? []).map((url) => /linkedin\.com\/in\//i.test(url) ? canonicalLinkedIn(url) : canonicalUrl(url)))];
        const linkedin = [...new Set((normalized.match(LI_PROFILE) ?? []).map(canonicalLinkedIn))];
        const resultCount = countSearchResults(raw, normalized, urls);
        metrics.rawSearchResults += resultCount;
        stats.rawResults += resultCount;
        metrics.urlsExtracted += urls.length;
        stats.urls += urls.length;
        metrics.linkedinUrlsExtracted += linkedin.length;
        metrics.publicProfileUrlsExtracted += urls.filter(isPublicProfileUrl).length;
        const candidateUrls = [...new Set([...linkedin, ...urls.filter(isPublicProfileUrl)])];

        if (!candidateUrls.length) {
          const searchCandidate = this.buildCandidateFromPage(profile, removeQueryEcho(normalized, query), source.id, metrics);
          if (searchCandidate) this.mergeCandidate(candidates, searchCandidate, stats, metrics);
          continue;
        }

        const searchEvidence = candidateUrls.map((url) => buildEvidence(removeQueryEcho(normalized, query), url)).filter(Boolean).join(" ").slice(0, 5000);
        const fetchedProfiles = await mapWithConcurrency(candidateUrls, PROFILE_CONCURRENCY, async (url) => {
          metrics.profileFetchAttempts += 1;
          const page = this.fetchText ? await this.fetchText(url, this.signal) : (await DEFAULT_FETCH(url, this.signal)).text;
          if (page) metrics.profilesFetched += 1;
          else metrics.profilesFetchFailures += 1;
          return { url, page };
        });

        for (const { url, page } of fetchedProfiles) {
          if (this.signal?.aborted || candidates.size >= this.targetCandidates) break;
          if (!page) continue;
          const profileEvidence = extractProfileEvidence(page, url);
          if (!profileEvidence) {
            metrics.profilesParseFailures += 1;
            reject(metrics, "PROFILE_PARSE_FAILED");
            continue;
          }
          metrics.profilesParsed += 1;
          const roleEvidence = [profileEvidence, searchEvidence].filter(Boolean).join(" ").slice(0, 7000);
          const combinedEvidence = [
            profileEvidence ? `[PROFILE_PAGE_EVIDENCE] ${profileEvidence}` : "",
            searchEvidence ? `[SEARCH_RESULT_EVIDENCE] ${searchEvidence}` : ""
          ].filter(Boolean).join(" ").slice(0, 7000);
          const result = this.buildCandidate(profile, url, roleEvidence, combinedEvidence, source.id, metrics);
          if (!result) continue;
          this.mergeCandidate(candidates, result, stats, metrics);
        }

        if (candidates.size < this.targetCandidates) {
          const searchCandidate = this.buildCandidateFromPage(profile, removeQueryEcho(normalized, query), source.id, metrics);
          if (searchCandidate) this.mergeCandidate(candidates, searchCandidate, stats, metrics);
        }
      }
    }
    metrics.finalDiscovered = candidates.size;
    return [...candidates.values()];
  }

  private mergeCandidate(candidates: Map<string, ProactiveRecruiterDiscoveryCandidate>, result: ProactiveRecruiterDiscoveryCandidate, stats: ProactiveRecruiterDiscoveryMetrics["sourceStats"][string], metrics: ProactiveRecruiterDiscoveryMetrics): void {
    const key = identityKey(result);
    const existing = candidates.get(key);
    if (existing) {
      metrics.duplicates += 1;
      stats.duplicates += 1;
      candidates.set(key, mergeCandidates(existing, result));
      return;
    }
    stats.candidates += 1;
    candidates.set(key, result);
  }

  private buildCandidate(profile: CandidateProfileLike, url: string, roleEvidence: string, evidence: string, source: SourceId, metrics: ProactiveRecruiterDiscoveryMetrics): ProactiveRecruiterDiscoveryCandidate | null {
    const roleMatch = this.matcher.match(profile, roleEvidence, "");
    if (!roleMatch.score || (roleMatch.roleTerms.some((term) => /software engineer|sde/.test(term)) && !FRONTEND_ROLE_TERMS.test(roleEvidence))) {
      reject(metrics, "ROLE_IRRELEVANT");
      return null;
    }
    metrics.relevanceAccepted += 1;
    if (!RECRUITING.test(evidence)) { reject(metrics, "NOT_RECRUITER"); return null; }
    metrics.recruiterEvidenceMatches += 1;
    if (NON_RECRUITING.test(evidence) && !RECRUITING.test(evidence.replace(NON_RECRUITING, ""))) { reject(metrics, "NOT_RECRUITER"); return null; }
    metrics.recruiterRoleMatches += 1;
    const recruiterName = extractRecruiterName(evidence);
    if (!recruiterName) { reject(metrics, "IDENTITY_AMBIGUOUS"); return null; }
    metrics.identityValidated += 1;
    const email = extractRecruiterEmail(evidence, profile);
    const employer = extractEmployer(evidence, email);
    if (employer.name !== "Unknown employer") metrics.companyValidated += 1;
    const now = this.now();
    const freshness = classifyEvidenceFreshness(evidence, now);
    const hiringEvidence = hasHiringEvidence(evidence);
    if (hiringEvidence) {
      metrics.hiringEvidenceAccepted += 1;
      incrementHiringFreshness(metrics, freshness);
    } else {
      metrics.hiringUnknown += 1;
    }
    return makeCandidate(recruiterName, roleMatch, employer, url, evidence, freshness, hiringEvidence, email, source, now);
  }

  private buildCandidateFromPage(profile: CandidateProfileLike, page: string, source: SourceId, metrics: ProactiveRecruiterDiscoveryMetrics): ProactiveRecruiterDiscoveryCandidate | null {
    if (!RECRUITING.test(page) || (NON_RECRUITING.test(page) && !/recruiter|talent acquisition|technical sourcer|hiring manager/i.test(page))) return null;
    const roleMatch = this.matcher.match(profile, page, "");
    if (!roleMatch.score) { reject(metrics, "ROLE_IRRELEVANT"); return null; }
    const name = extractRecruiterName(page);
    const email = extractRecruiterEmail(page, profile);
    if (!name) { reject(metrics, "IDENTITY_AMBIGUOUS"); return null; }
    const employer = extractEmployer(page, email);
    if (employer.name === "Unknown employer") { reject(metrics, "COMPANY_UNKNOWN"); return null; }
    metrics.recruiterRoleMatches += 1;
    metrics.recruiterEvidenceMatches += 1;
    metrics.identityValidated += 1;
    metrics.companyValidated += 1;
    const now = this.now();
    const freshness = classifyEvidenceFreshness(page, now);
    const hiringEvidence = hasHiringEvidence(page);
    if (hiringEvidence) {
      metrics.hiringEvidenceAccepted += 1;
      incrementHiringFreshness(metrics, freshness);
    } else {
      metrics.hiringUnknown += 1;
    }
    return makeCandidate(name, roleMatch, employer, `public-search:${source}:${hashKey(page)}`, `[SEARCH_RESULT_EVIDENCE] ${page.slice(0, 3000)}`, freshness, hiringEvidence, email, source, now);
  }
}

function makeCandidate(recruiterName: string, roleMatch: ReturnType<ProactiveRecruiterRoleMatcher["match"]>, employer: { name: string; domain?: string }, url: string, evidence: string, freshness: ProactiveRecruiterDiscoveryCandidate["evidenceFreshness"], hiringEvidence: boolean, email: string | undefined, source: SourceId, now: Date): ProactiveRecruiterDiscoveryCandidate {
  return {
    recruiterName,
    recruiterRole: roleMatch.recruiterTerms[0] ?? "Recruiting professional",
    employer: employer.name,
    ...(employer.domain ? { employerDomain: employer.domain } : {}),
    targetRoles: roleMatch.roleTerms,
    roleMatchScore: Math.min(100, roleMatch.score),
    hiringEvidenceScore: hiringEvidence ? Math.min(100, roleMatch.roleTerms.length * 20 + 40) : 0,
    overallConfidence: Math.min(100, roleMatch.score + (employer.domain ? 5 : 0)),
    discoverySource: "public-web",
    discoveryUrl: url,
    discoveryEvidence: [evidence],
    evidenceType: hiringEvidence ? "job_hiring_evidence" : "public_profile",
    evidenceDate: inferEvidenceDate(evidence, now).toISOString(),
    evidenceFreshness: freshness,
    ...(email ? { email } : {}),
    emailStatus: "UNVERIFIED"
  };
}

function extractProfileEvidence(page: string, url: string): string {
  const raw = page.slice(0, 16000);
  const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const descriptions = [...raw.matchAll(/<meta[^>]+(?:name|property)=["']([^"']+)["'][^>]+content=["']([^"']*)["']/gi)]
    .filter((match) => /description|og:title|og:description/i.test(match[1] ?? ""))
    .map((match) => match[2] ?? "");
  const canonical = raw.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ?? url;
  const jsonLd = [...raw.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1] ?? "").join(" ");
  const headings = [...raw.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((match) => stripHtml(match[1] ?? "")).join(" ");
  const visible = stripHtml(raw);
  const combined = [title, ...descriptions, canonical, jsonLd, headings, visible].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!combined || combined.length < 40) return "";
  if (/(?:verify you are human|captcha|access denied|unusual traffic|just a moment|robot check|enable javascript)/i.test(combined) && !RECRUITING.test(combined)) return "";
  return combined.slice(0, 7000);
}

function buildEvidence(text: string, url: string): string {
  const index = text.toLowerCase().indexOf(url.toLowerCase());
  return (index >= 0 ? text.slice(Math.max(0, index - 1400), Math.min(text.length, index + 1800)) : text.slice(0, 2600)).slice(0, 3600);
}

function removeQueryEcho(text: string, query: string): string {
  const variants = [query, query.replace(/"/g, ""), decodeURIComponent(query)];
  return variants.reduce((value, variant) => value.split(variant).join(" "), text);
}

function countSearchResults(raw: string, normalized: string, urls: string[]): number {
  try {
    const parsed = JSON.parse(raw) as { results?: unknown[]; web?: { results?: unknown[] }; organic?: unknown[] };
    const count = parsed.results?.length ?? parsed.web?.results?.length ?? parsed.organic?.length;
    if (typeof count === "number") return count;
  } catch { /* HTML/markdown search response. */ }
  const resultMarkers = normalized.match(/(?:\n|^)(?:\d+[.)]|result|sponsored|organic result|web result)\b/gi)?.length ?? 0;
  return Math.max(resultMarkers, urls.length > 0 ? urls.length : 0);
}

function isPublicProfileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (SEARCH_HOSTS.has(host)) return false;
    if (host.endsWith("linkedin.com") && /^\/in\//i.test(url.pathname)) return true;
    return PROFILE_PATH.test(url.pathname);
  } catch { return false; }
}

function identityKey(candidate: ProactiveRecruiterDiscoveryCandidate): string {
  if (candidate.discoveryUrl.startsWith("https://www.linkedin.com/in/")) return `linkedin:${candidate.discoveryUrl}`;
  if (candidate.email) return `email:${candidate.email.toLowerCase()}`;
  return `person:${candidate.recruiterName.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${candidate.employerDomain ?? candidate.employer.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

function mergeCandidates(a: ProactiveRecruiterDiscoveryCandidate, b: ProactiveRecruiterDiscoveryCandidate): ProactiveRecruiterDiscoveryCandidate {
  return {
    ...a,
    recruiterRole: a.recruiterRole === "Recruiting professional" ? b.recruiterRole : a.recruiterRole,
    employer: a.employer === "Unknown employer" ? b.employer : a.employer,
    ...(a.employerDomain || !b.employerDomain ? {} : { employerDomain: b.employerDomain }),
    roleMatchScore: Math.max(a.roleMatchScore, b.roleMatchScore),
    hiringEvidenceScore: Math.max(a.hiringEvidenceScore, b.hiringEvidenceScore),
    overallConfidence: Math.max(a.overallConfidence, b.overallConfidence),
    targetRoles: [...new Set([...a.targetRoles, ...b.targetRoles])],
    discoveryEvidence: [...new Set([...a.discoveryEvidence, ...b.discoveryEvidence])].slice(0, 6),
    evidenceType: a.evidenceType === "job_hiring_evidence" || b.evidenceType === "job_hiring_evidence" ? "job_hiring_evidence" : "public_profile",
    evidenceFreshness: freshnessRank(b.evidenceFreshness) > freshnessRank(a.evidenceFreshness) ? b.evidenceFreshness : a.evidenceFreshness,
    evidenceDate: freshnessRank(b.evidenceFreshness) > freshnessRank(a.evidenceFreshness) ? b.evidenceDate : a.evidenceDate,
    email: a.email ?? b.email,
    emailStatus: a.emailStatus === "VERIFIED" ? a.emailStatus : b.emailStatus
  };
}

function extractRecruiterName(evidence: string): string | undefined {
  const patterns = [
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s*(?:-|—|\||•|:)\s*(?:Senior\s+|Lead\s+|Principal\s+|Executive\s+|Technical\s+|IT\s+|Engineering\s+|Talent\s+)?(?:Recruiter|Recruiting|Talent Acquisition|Talent Partner|Talent Sourcer|Technical Sourcer|Hiring Manager)\b/i,
    /\b([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,4})\s+(?:is\s+)?(?:a\s+)?(?:Senior\s+|Lead\s+|Principal\s+|Technical\s+|IT\s+|Engineering\s+)?(?:Recruiter|Recruiting|Talent Acquisition|Talent Partner|Talent Sourcer|Technical Sourcer|Hiring Manager)\b/i,
    /\b(?:Recruiter|Talent Acquisition|Talent Partner|Technical Sourcer|Hiring Manager)\s+(?:at|@)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/i
  ];
  for (const pattern of patterns) {
    const match = evidence.match(pattern)?.[1]?.trim();
    if (match && isLikelyPersonName(match)) return match;
  }
  const email = evidence.match(EMAIL_PATTERN)?.[0];
  if (email) {
    const emailIndex = evidence.toLowerCase().indexOf(email.toLowerCase());
    const before = emailIndex >= 0 ? evidence.slice(Math.max(0, emailIndex - 220), emailIndex) : evidence;
    const candidates = before.match(/\b[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}\b/g) ?? [];
    const last = candidates.at(-1);
    if (last && isLikelyPersonName(last)) return last.trim();
  }
  return undefined;
}

function isLikelyPersonName(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 4 || normalized.length > 80) return false;
  if (/^(Technical|Senior|Lead|Principal|Talent|Human|Resource|Hiring|Recruiter|Recruiting|Manager|India|Bangalore|Bengaluru|React|Frontend|Software|Engineering|Acme|Stackforce)\b/i.test(normalized)) return false;
  const words = normalized.split(" ");
  return words.length >= 2 && words.length <= 5 && words.every((word) => /^[A-Z][A-Za-z.'-]+$/.test(word));
}

function extractRecruiterEmail(evidence: string, profile: CandidateProfileLike): string | undefined {
  const emails = [...new Set((evidence.match(EMAIL_PATTERN) ?? []).map((email) => email.toLowerCase()))];
  const skillTerms = [...(profile.skills ?? []), ...(profile.targetRoles ?? [])].map((term) => term.toLowerCase());
  return emails.find((email) => {
    const domain = email.split("@")[1] ?? "";
    const index = evidence.toLowerCase().indexOf(email);
    const context = index >= 0 ? evidence.slice(Math.max(0, index - 500), Math.min(evidence.length, index + 700)) : evidence;
    return domain && !GENERIC_EMAIL_DOMAINS.has(domain) && !NON_RECRUITING.test(context) && (RECRUITING.test(context) || skillTerms.some((term) => context.toLowerCase().includes(term)));
  });
}

function extractEmployer(evidence: string, email?: string): { name: string; domain?: string } {
  const emailDomain = email?.split("@")[1]?.toLowerCase();
  const atMatch = evidence.match(/\b(?:at|@)\s+([A-Z][A-Za-z0-9&.' -]{2,80}?)(?=\s+(?:hiring|recruiting|for|at|on|the|\||-|•|,|$))/i);
  const titleMatch = evidence.match(/\b(?:Recruiter|Recruiting|Talent Acquisition|Talent Partner|Technical Sourcer)\s+(?:at|@)\s+([A-Z][A-Za-z0-9&.' -]{2,80})/i);
  const name = (atMatch?.[1] ?? titleMatch?.[1])?.trim().replace(/[|•,.-]+$/, "").trim();
  const candidateDomains = [...new Set((evidence.match(URL_PATTERN) ?? []).map(canonicalUrl).map((value) => {
    try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
  }).filter((domain) => domain && !SEARCH_HOSTS.has(domain) && !domain.endsWith("linkedin.com")))];
  const matchingDomain = name ? candidateDomains.find((domain) => {
    const root = domain.split(".")[0]?.replace(/[^a-z0-9]/g, "") ?? "";
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return root.length >= 3 && normalizedName.length >= 3 && (normalizedName.includes(root) || root.includes(normalizedName));
  }) : undefined;
  if (name && emailDomain && !GENERIC_EMAIL_DOMAINS.has(emailDomain)) {
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const domainRoot = emailDomain.split(".")[0]?.replace(/[^a-z0-9]/g, "") ?? "";
    if (normalizedName && domainRoot && (normalizedName.includes(domainRoot) || domainRoot.includes(normalizedName))) return { name, domain: emailDomain };
    return { name: "Unknown employer" };
  }
  if (name) return { name, ...(matchingDomain ? { domain: matchingDomain } : {}) };
  if (emailDomain && !GENERIC_EMAIL_DOMAINS.has(emailDomain)) return { name: domainToCompany(emailDomain), domain: emailDomain };
  if (matchingDomain) return { name: domainToCompany(matchingDomain), domain: matchingDomain };
  return { name: "Unknown employer" };
}

function domainToCompany(domain: string): string {
  const root = domain.split(".")[0]?.replace(/[-_]+/g, " ").trim() ?? domain;
  return root.replace(/\b\w/g, (char) => char.toUpperCase());
}

function hasHiringEvidence(evidence: string): boolean {
  return CURRENT_HIRING_EVIDENCE.test(evidence) || (RECENT_HIRING_EVIDENCE.test(evidence) && /hiring|recruiting|recruiter|role|position|opening/i.test(evidence));
}

function classifyEvidenceFreshness(evidence: string, now: Date): ProactiveRecruiterDiscoveryCandidate["evidenceFreshness"] {
  const lower = evidence.toLowerCase();
  if (CURRENT_HIRING_EVIDENCE.test(lower)) return "current";
  if (RECENT_HIRING_EVIDENCE.test(lower)) return "recent";
  const years = [...lower.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  if (years.some((year) => now.getFullYear() - year >= 2)) return "historical";
  if (/historical|previously|formerly|past hiring|used to recruit/.test(lower)) return "historical";
  return "unknown";
}

function inferEvidenceDate(evidence: string, now: Date): Date {
  const years = [...evidence.matchAll(/\b(20\d{2})\b/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  const relevantYear = years.find((year) => year <= now.getFullYear());
  return relevantYear ? new Date(Date.UTC(relevantYear, 0, 1)) : now;
}

function incrementHiringFreshness(metrics: ProactiveRecruiterDiscoveryMetrics, freshness: ProactiveRecruiterDiscoveryCandidate["evidenceFreshness"]): void {
  if (freshness === "current") metrics.hiringCurrent += 1;
  else if (freshness === "recent") metrics.hiringRecent += 1;
  else if (freshness === "historical") metrics.hiringHistorical += 1;
  else metrics.hiringUnknown += 1;
}

function freshnessRank(value: ProactiveRecruiterDiscoveryCandidate["evidenceFreshness"]): number {
  return value === "current" ? 4 : value === "recent" ? 3 : value === "historical" ? 2 : 1;
}

function hashKey(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return Math.abs(hash >>> 0).toString(16);
}
