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

export interface ProactiveRecruiterDiscoveryOptions {
  fetchText?: (url: string, signal?: AbortSignal) => Promise<string | null>;
  now?: () => Date;
  maxQueries?: number;
  signal?: AbortSignal;
}

type SourceId = "google-jina" | "bing-jina" | "duckduckgo-jina" | "startpage-jina" | "ecosia-jina" | "jina-search" | "brave-api" | "mojeek-api";
interface Source { id: SourceId; url: string; headers?: Record<string, string>; }
interface SourceStats { attempted: number; succeeded: number; empty: number; timeouts: number; http403: number; http429: number; http5xx: number; otherHttpErrors: number; candidates: number; }

const SEARCH_CONCURRENCY = 4;
const TIMEOUT = 7000;
const RETRIES = 2;
const JINA_READER_GAP_MS = 3100;
const GENERIC_EMAIL_DOMAINS = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com"]);
const CURRENT_HIRING_EVIDENCE = /currently|currently hiring|hiring now|actively hiring|we are hiring|open roles|open positions|urgent hiring|hiring for/i;
const RECENT_HIRING_EVIDENCE = /last week|last month|recently|recent hiring|2026|2025/i;
const RECRUITING = /(recruiter|recruiting|talent acquisition|talent partner|talent sourcer|technical sourcer|hiring manager|human resources|\bhr\b|staffing|hiring|people ops?|recruitment)/i;
const NON_RECRUITING = /(customer support|technical support|sales|billing|privacy|legal|security|press|media|partnerships?|helpdesk|procurement|accounting|finance|customer success|marketing)/i;
const LINKEDIN_PROFILE = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
let jinaReaderNextAt = 0;

const DEFAULT_FETCH = async (url: string, signal?: AbortSignal): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept: "application/json,text/plain,text/html,*/*;q=0.8", "user-agent": "job-agent-proactive-recruiter/7.0" } });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
};

const stripHtml = (value: string): string => value
  .replace(/<((?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-z0-9-_%]+)>/gi, "$1")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&#64;|&#x40;/gi, "@")
  .replace(/&#46;|&#x2e;/gi, ".")
  .replace(/\s+/g, " ")
  .trim();

const canonicalLinkedIn = (value: string): string => {
  try {
    const url = new URL(value);
    const profile = url.pathname.match(/^\/in\/([^/?#]+)/i)?.[1];
    return profile ? `https://www.linkedin.com/in/${profile.toLowerCase()}` : value;
  } catch {
    return value.toLowerCase().replace(/\/+$/, "");
  }
};

function sourceList(query: string): Source[] {
  const q = encodeURIComponent(query);
  const sources: Source[] = [
    { id: "google-jina", url: `https://r.jina.ai/https://www.google.com/search?q=${q}&gbv=1` },
    { id: "bing-jina", url: `https://r.jina.ai/https://www.bing.com/search?q=${q}` },
    { id: "duckduckgo-jina", url: `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${q}` },
    { id: "startpage-jina", url: `https://r.jina.ai/https://www.startpage.com/sp/search?query=${q}` },
    { id: "ecosia-jina", url: `https://r.jina.ai/https://www.ecosia.org/search?q=${q}` }
  ];
  if (process.env.JINA_API_KEY?.trim()) sources.push({ id: "jina-search", url: `https://s.jina.ai/${q}`, headers: { authorization: `Bearer ${process.env.JINA_API_KEY.trim()}` } });
  if (process.env.BRAVE_SEARCH_API_KEY?.trim()) sources.push({ id: "brave-api", url: `https://api.search.brave.com/res/v1/web/search?q=${q}&count=20&extra_snippets=true`, headers: { "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY.trim(), accept: "application/json" } });
  if (process.env.MOJEEK_API_KEY?.trim()) sources.push({ id: "mojeek-api", url: `https://api.mojeek.com/search?q=${q}&api_key=${encodeURIComponent(process.env.MOJEEK_API_KEY.trim())}&fmt=json&t=20`, headers: { accept: "application/json" } });
  return sources;
}

const isJinaReader = (id: SourceId): boolean => ["google-jina", "bing-jina", "duckduckgo-jina", "startpage-jina", "ecosia-jina"].includes(id);

async function fetchSource(source: Source, fetcher: ProactiveRecruiterDiscoveryOptions["fetchText"], signal: AbortSignal | undefined, stats: SourceStats): Promise<string | null> {
  stats.attempted += 1;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    if (signal?.aborted) return null;
    if (isJinaReader(source.id) && !process.env.JINA_API_KEY?.trim()) {
      const wait = Math.max(0, jinaReaderNextAt - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      jinaReaderNextAt = Date.now() + JINA_READER_GAP_MS;
    }
    const text = fetcher ? await fetcher(source.url, signal) : await DEFAULT_FETCH(source.url, signal);
    if (text) {
      stats.succeeded += 1;
      return text;
    }
    if (attempt === RETRIES) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(5000, 250 * (2 ** attempt) + Math.floor(Math.random() * 200))));
  }
  stats.empty += 1;
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
  private readonly fetchText: (url: string, signal?: AbortSignal) => Promise<string | null>;
  private readonly now: () => Date;
  private readonly maxQueries: number;
  private readonly signal?: AbortSignal;

  constructor(options: ProactiveRecruiterDiscoveryOptions = {}) {
    this.fetchText = options.fetchText ?? DEFAULT_FETCH;
    this.now = options.now ?? (() => new Date());
    this.maxQueries = Math.max(1, options.maxQueries ?? (Number(process.env.PROACTIVE_RECRUITER_MAX_QUERIES) || 18));
    this.signal = options.signal;
  }

  buildQueries(profile: CandidateProfileLike): string[] {
    const roles = this.matcher.buildTargetTerms(profile).filter((term) => term.length >= 4).slice(0, 10);
    const rolePhrase = roles.map((role) => `"${role}"`).join(" OR ");
    const locations = (profile.preferredLocations ?? []).filter(Boolean).slice(0, 3);
    const locationPhrase = locations.length ? ` "${locations[0]}"` : " India";
    const tech = (profile.skills ?? []).filter(Boolean).slice(0, 3).map((skill) => `"${skill}"`).join(" OR ") || rolePhrase;
    const primaryRole = roles[0] ?? "frontend developer";
    return [...new Set([
      `site:linkedin.com/in recruiter (${rolePhrase})`,
      `site:linkedin.com/in "technical recruiter" (${rolePhrase})`,
      `site:linkedin.com/in "talent acquisition" (${rolePhrase})`,
      `site:linkedin.com/in "talent partner" (${rolePhrase})`,
      `site:linkedin.com/in "engineering recruiter" (${rolePhrase})`,
      `site:linkedin.com/in "technical sourcer" (${rolePhrase})`,
      `site:linkedin.com/in "hiring manager" (${rolePhrase})`,
      `site:linkedin.com/in recruiter (${rolePhrase})${locationPhrase}`,
      `site:linkedin.com/in recruiter (${tech})${locationPhrase}`,
      `site:linkedin.com/in recruiter "React" "TypeScript"${locationPhrase}`,
      `"${primaryRole}" recruiter${locationPhrase}`,
      `"${primaryRole}" "talent acquisition"${locationPhrase}`,
      `"${primaryRole}" "technical recruiter"${locationPhrase}`,
      `"${primaryRole}" "engineering recruiter"${locationPhrase}`,
      `"${primaryRole}" "technical sourcer"${locationPhrase}`,
      `recruiter "${primaryRole}" India`,
      `talent acquisition "${primaryRole}" India`,
      `hiring manager "${primaryRole}" India`
    ])].slice(0, this.maxQueries);
  }

  async discover(profile: CandidateProfileLike): Promise<ProactiveRecruiterDiscoveryCandidate[]> {
    const queries = this.buildQueries(profile);
    const stats: Record<string, SourceStats> = {};
    const requests = queries.flatMap((query) => sourceList(query));
    const searchPages = (await mapWithConcurrency(requests, SEARCH_CONCURRENCY, async (source) => {
      const sourceStats = stats[source.id] ?? (stats[source.id] = { attempted: 0, succeeded: 0, empty: 0, timeouts: 0, http403: 0, http429: 0, http5xx: 0, otherHttpErrors: 0, candidates: 0 });
      return { source, text: await fetchSource(source, this.fetchText, this.signal, sourceStats) };
    })).filter((result): result is { source: Source; text: string } => Boolean(result.text));

    const candidates = new Map<string, ProactiveRecruiterDiscoveryCandidate>();
    const seenUrls = new Set<string>();
    for (const { source, text: raw } of searchPages) {
      const text = stripHtml(raw);
      for (const match of text.matchAll(LINKEDIN_PROFILE)) {
        const url = canonicalLinkedIn(match[0]);
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        const index = match.index ?? 0;
        const evidence = text.slice(Math.max(0, index - 650), Math.min(text.length, index + 1000));
        const roleMatch = this.matcher.match(profile, evidence, evidence);
        if (!roleMatch.score || !RECRUITING.test(evidence) || NON_RECRUITING.test(evidence)) continue;
        const recruiterName = extractRecruiterName(evidence);
        if (recruiterName === "Unknown recruiter") continue;
        const email = extractRecruiterEmail(evidence, profile);
        const employer = extractEmployer(evidence, email);
        const now = this.now();
        const evidenceFreshness = classifyEvidenceFreshness(evidence, now);
        const hiringEvidence = hasHiringEvidence(evidence);
        const sourceStats = stats[source.id];
        if (sourceStats) sourceStats.candidates += 1;
        const candidate: ProactiveRecruiterDiscoveryCandidate = {
          recruiterName,
          recruiterRole: roleMatch.recruiterTerms[0] ?? "Recruiting professional",
          employer: employer.name,
          ...(employer.domain ? { employerDomain: employer.domain } : {}),
          targetRoles: roleMatch.roleTerms,
          roleMatchScore: Math.min(100, roleMatch.score),
          hiringEvidenceScore: hiringEvidence ? Math.min(100, roleMatch.roleTerms.length * 20 + 40) : 0,
          overallConfidence: Math.min(100, roleMatch.score),
          discoverySource: "public-web",
          discoveryUrl: url,
          discoveryEvidence: [evidence],
          evidenceType: hiringEvidence ? "job_hiring_evidence" : "public_profile",
          evidenceDate: inferEvidenceDate(evidence, now).toISOString(),
          evidenceFreshness,
          email,
          emailStatus: "UNVERIFIED"
        };
        const existing = candidates.get(url);
        candidates.set(url, existing ? {
          ...existing,
          roleMatchScore: Math.max(existing.roleMatchScore, candidate.roleMatchScore),
          hiringEvidenceScore: Math.max(existing.hiringEvidenceScore, candidate.hiringEvidenceScore),
          overallConfidence: Math.max(existing.overallConfidence, candidate.overallConfidence),
          discoveryEvidence: [...new Set([...existing.discoveryEvidence, evidence])].slice(0, 5),
          email: existing.email ?? candidate.email,
          employer: existing.employer === "Unknown employer" ? candidate.employer : existing.employer,
          ...(existing.employerDomain || !candidate.employerDomain ? {} : { employerDomain: candidate.employerDomain }),
          evidenceType: existing.evidenceType === "job_hiring_evidence" || candidate.evidenceType === "job_hiring_evidence" ? "job_hiring_evidence" : "public_profile",
          evidenceFreshness: freshnessRank(candidate.evidenceFreshness) > freshnessRank(existing.evidenceFreshness) ? candidate.evidenceFreshness : existing.evidenceFreshness,
          evidenceDate: freshnessRank(candidate.evidenceFreshness) > freshnessRank(existing.evidenceFreshness) ? candidate.evidenceDate : existing.evidenceDate
        } : candidate);
      }
    }
    return [...candidates.values()];
  }
}

function hasHiringEvidence(evidence: string): boolean {
  return CURRENT_HIRING_EVIDENCE.test(evidence) || (RECENT_HIRING_EVIDENCE.test(evidence) && /hiring|recruiting|recruiter|role|position|opening/i.test(evidence));
}

function extractRecruiterName(evidence: string): string {
  const roleTerms = "technical|it|technology|software|engineering|talent|recruiting|recruiter|sourcer|hiring";
  const delimited = evidence.match(new RegExp(`\\b([A-Z][A-Za-z.'-]+(?:\\s+[A-Z][A-Za-z.'-]+){1,3})\\s*(?:-|\\||•|:)\\s*(?:${roleTerms})\\b`, "i"));
  if (delimited?.[1]) return delimited[1].trim();
  const adjacent = evidence.match(new RegExp(`\\b([A-Z][A-Za-z.'-]+(?:\\s+[A-Za-z.'-]+)?)\\s+(?:${roleTerms})\\b`, "i"));
  if (adjacent?.[1]) return adjacent[1].trim();
  const capitalizedWords = evidence.match(/\b[A-Z][a-z'-]+\b/g) ?? [];
  if (RECRUITING.test(evidence) && capitalizedWords.length >= 2) return capitalizedWords.slice(0, 2).join(" ");
  return "Unknown recruiter";
}

function extractRecruiterEmail(evidence: string, profile: CandidateProfileLike): string | undefined {
  const emails = [...new Set((evidence.match(EMAIL_PATTERN) ?? []).map((email) => email.toLowerCase()))];
  const skillTerms = [...(profile.skills ?? []), ...(profile.targetRoles ?? [])].map((term) => term.toLowerCase());
  return emails.find((email) => {
    const domain = email.split("@")[1] ?? "";
    const index = evidence.toLowerCase().indexOf(email);
    const context = index >= 0 ? evidence.slice(Math.max(0, index - 250), Math.min(evidence.length, index + 450)) : evidence;
    return !GENERIC_EMAIL_DOMAINS.has(domain) && !NON_RECRUITING.test(context) && (RECRUITING.test(context) || skillTerms.some((term) => context.toLowerCase().includes(term)));
  });
}

function classifyEvidenceFreshness(evidence: string, now: Date): "current" | "recent" | "historical" | "unknown" {
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
  const historicalYear = years.find((year) => year <= now.getFullYear());
  return historicalYear ? new Date(Date.UTC(historicalYear, 0, 1)) : now;
}

function freshnessRank(value: ProactiveRecruiterDiscoveryCandidate["evidenceFreshness"]): number {
  return value === "current" ? 4 : value === "recent" ? 3 : value === "historical" ? 2 : 1;
}

function extractEmployer(evidence: string, email?: string): { name: string; domain?: string } {
  const emailDomain = email?.split("@")[1]?.toLowerCase();
  const atMatch = evidence.match(/\bat\s+([A-Z][A-Za-z0-9&.' -]{2,60}?)(?=\s+(?:hiring|recruiting|for|at|on|\||-|•|,|$))/i);
  const name = atMatch?.[1]?.trim().replace(/[|•,.-]+$/, "").trim();
  if (!name || !emailDomain || GENERIC_EMAIL_DOMAINS.has(emailDomain)) return { name: name || "Unknown employer" };
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const domainRoot = emailDomain.split(".")[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  if (!normalizedName || !domainRoot || !(normalizedName.includes(domainRoot) || domainRoot.includes(normalizedName))) return { name: "Unknown employer" };
  return { name, domain: emailDomain };
}
