import { ProactiveRecruiterRoleMatcher, CandidateProfileLike } from "./ProactiveRecruiterRoleMatcher";

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
}

export interface ProactiveRecruiterDiscoveryOptions {
  fetchText?: (url: string) => Promise<string | null>;
  now?: () => Date;
  maxQueries?: number;
}

const SEARCH_ENDPOINTS = [
  "https://r.jina.ai/https://www.google.com/search?q=",
  "https://r.jina.ai/https://www.bing.com/search?q=",
  "https://r.jina.ai/https://html.duckduckgo.com/html/?q="
];
const GENERIC_EMAIL_DOMAINS = new Set(["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com"]);

const DEFAULT_FETCH = async (url: string): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept: "text/html,text/plain,*/*;q=0.8", "user-agent": "job-agent-proactive-recruiter/1.0" } });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const stripHtml = (value: string): string => value
  .replace(/<((?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-z0-9-_%]+)>/gi, "$1")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim();
const linkedinProfile = /https?:\/\/(?:www\.|[a-z]{2}\.)?linkedin\.com\/in\/[a-z0-9-_%]+/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export class ProactiveRecruiterDiscoveryService {
  private readonly matcher = new ProactiveRecruiterRoleMatcher();
  private readonly fetchText: (url: string) => Promise<string | null>;
  private readonly now: () => Date;
  private readonly maxQueries: number;

  constructor(options: ProactiveRecruiterDiscoveryOptions = {}) {
    this.fetchText = options.fetchText ?? DEFAULT_FETCH;
    this.now = options.now ?? (() => new Date());
    this.maxQueries = Math.max(1, options.maxQueries ?? 12);
  }

  buildQueries(profile: CandidateProfileLike): string[] {
    const roles = this.matcher.buildTargetTerms(profile).filter((term) => term.length >= 4).slice(0, 8);
    const rolePhrase = roles.map((role) => `"${role}"`).join(" OR ");
    return [
      `site:linkedin.com/in recruiter (${rolePhrase})`,
      `site:linkedin.com/in "technical recruiter" (${rolePhrase})`,
      `site:linkedin.com/in "talent acquisition" (${rolePhrase})`,
      `site:linkedin.com/in "engineering recruiter" (${rolePhrase})`,
      `site:linkedin.com/in "technical sourcer" (${rolePhrase})`,
      `site:linkedin.com/in "hiring manager" (${rolePhrase})`
    ].slice(0, this.maxQueries);
  }

  async discover(profile: CandidateProfileLike): Promise<ProactiveRecruiterDiscoveryCandidate[]> {
    const pages = await Promise.all(this.buildQueries(profile).flatMap((query) => SEARCH_ENDPOINTS.map((endpoint) => this.fetchText(`${endpoint}${encodeURIComponent(query)}`))));
    const candidates = new Map<string, ProactiveRecruiterDiscoveryCandidate>();
    for (const raw of pages) {
      if (!raw) continue;
      const text = stripHtml(raw);
      for (const match of text.matchAll(linkedinProfile)) {
        const url = match[0];
        const index = match.index ?? 0;
        const evidence = text.slice(Math.max(0, index - 500), Math.min(text.length, index + 800));
        const now = this.now();
        const roleMatch = this.matcher.match(profile, evidence, evidence);
        if (!roleMatch.score) continue;
        const email = evidence.match(emailPattern)?.[0]?.toLowerCase();
        const employer = extractEmployer(evidence, email);
        const recruiterName = extractRecruiterName(evidence);
        if (recruiterName === "Unknown recruiter") continue;
        const key = url.toLowerCase();
        const evidenceFreshness = classifyEvidenceFreshness(evidence, now);
        const candidate: ProactiveRecruiterDiscoveryCandidate = {
          recruiterName,
          recruiterRole: roleMatch.recruiterTerms[0] ?? "Recruiting professional",
          employer: employer.name,
          ...(employer.domain ? { employerDomain: employer.domain } : {}),
          targetRoles: roleMatch.roleTerms,
          roleMatchScore: Math.min(100, roleMatch.score),
          hiringEvidenceScore: Math.min(100, roleMatch.roleTerms.length * 20 + roleMatch.recruiterTerms.length * 10),
          overallConfidence: Math.min(100, roleMatch.score),
          discoverySource: "public-web",
          discoveryUrl: url,
          discoveryEvidence: [evidence],
          evidenceType: evidence.toLowerCase().includes("hiring") || evidence.toLowerCase().includes("recruiting") ? "job_hiring_evidence" : "public_profile",
          evidenceDate: inferEvidenceDate(evidence, now).toISOString(),
          evidenceFreshness,
          email,
          emailStatus: "UNVERIFIED"
        };
        const existing = candidates.get(key);
        candidates.set(key, existing ? {
          ...existing,
          roleMatchScore: Math.max(existing.roleMatchScore, candidate.roleMatchScore),
          hiringEvidenceScore: Math.max(existing.hiringEvidenceScore, candidate.hiringEvidenceScore),
          overallConfidence: Math.max(existing.overallConfidence, candidate.overallConfidence),
          discoveryEvidence: [...new Set([...existing.discoveryEvidence, evidence])].slice(0, 5),
          email: existing.email ?? candidate.email,
          employer: existing.employer === "Unknown employer" ? candidate.employer : existing.employer,
          ...(existing.employerDomain || !candidate.employerDomain ? {} : { employerDomain: candidate.employerDomain }),
          evidenceFreshness: freshnessRank(candidate.evidenceFreshness) > freshnessRank(existing.evidenceFreshness) ? candidate.evidenceFreshness : existing.evidenceFreshness,
          evidenceDate: freshnessRank(candidate.evidenceFreshness) > freshnessRank(existing.evidenceFreshness) ? candidate.evidenceDate : existing.evidenceDate
        } : candidate);
      }
    }
    return [...candidates.values()];
  }
}

function extractRecruiterName(evidence: string): string {
  const match = evidence.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){1,3})\s*(?:-|\||•|:)\s*(?:technical|it|technology|software|engineering|talent|recruiting|recruiter|sourcer|hiring)/i);
  return match?.[1]?.trim() ?? "Unknown recruiter";
}

function classifyEvidenceFreshness(evidence: string, now: Date): "current" | "recent" | "historical" | "unknown" {
  const lower = evidence.toLowerCase();
  if (/currently|current(?:ly)?|this week|this month|hiring now|open roles|actively hiring|we are hiring/.test(lower)) return "current";
  if (/last week|last month|recently|recent|2026|2025/.test(lower)) return "recent";
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
