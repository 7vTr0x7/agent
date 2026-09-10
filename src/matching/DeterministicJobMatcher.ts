import { JobOpportunity } from "../jobs/domain/JobOpportunity";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobDecision } from "../shared/types/job";

export interface MatchEvidence {
  type: "SKILL_MATCH" | "SKILL_GAP" | "TITLE_MATCH" | "EXPERIENCE" | "HARD_BLOCKER" | "ROLE_FIT" | "LOCATION";
  detail: string;
}

export interface DeterministicMatchResult {
  matchScore: number;
  decision: JobDecision;
  matchedSkills: string[];
  missingSkills: string[];
  evidence: MatchEvidence[];
  reason: string;
}

export interface DeterministicMatcherOptions {
  applyThreshold?: number;
  reviewThreshold?: number;
}

const SKILL_ALIASES: Record<string, string[]> = {
  "react.js": ["react", "reactjs", "react.js"],
  react: ["react", "reactjs", "react.js"],
  "next.js": ["next", "nextjs", "next.js", "next js"],
  nextjs: ["next", "nextjs", "next.js", "next js"],
  "node.js": ["node", "nodejs", "node.js", "node js"],
  node: ["node", "nodejs", "node.js", "node js"],
  "express.js": ["express", "expressjs", "express.js", "express js"],
  express: ["express", "expressjs", "express.js", "express js"],
  javascript: ["javascript", "js", "ecmascript"],
  js: ["javascript", "js", "ecmascript"],
  typescript: ["typescript", "ts"],
  ts: ["typescript", "ts"],
  "react testing library": ["react testing library", "rtl"],
  rtl: ["react testing library", "rtl"],
  "redux toolkit": ["redux toolkit", "@reduxjs/toolkit"],
  "tailwind css": ["tailwind css", "tailwind"],
  mongodb: ["mongodb", "mongo db", "mongo"],
  postgresql: ["postgresql", "postgres", "postgre sql"],
  postgres: ["postgresql", "postgres", "postgre sql"]
};

const FRONTEND_ROLE_SIGNAL = /\b(frontend|front-end|front end|ui developer|ui engineer|web developer|web engineer|react developer|react engineer|next\.js developer|nextjs developer|full[- ]stack|fullstack|software engineer)\b/i;
const STRONG_FRONTEND_SIGNAL = /\b(react|reactjs|react\.js|next\.js|nextjs|redux|frontend|front-end|front end|ui developer|ui engineer)\b/i;
const EXCLUDED_ROLE_TITLE = /\b(product marketing|marketing|sales|account executive|business development|finance|accounting|legal|procurement|recruiter|talent acquisition|customer support|technical support|qa engineer|quality assurance|devops|site reliability|\bsre\b|network engineer|data analyst|data scientist|machine learning engineer|ml engineer|ai engineer)\b/i;
const BACKEND_ONLY_TITLE = /\b(backend|back-end|back end|java developer|python developer|\.net developer|golang developer|database administrator|dba)\b/i;

export class DeterministicJobMatcher {
  private readonly applyThreshold: number;
  private readonly reviewThreshold: number;

  constructor(options: DeterministicMatcherOptions = {}) {
    this.applyThreshold = options.applyThreshold ?? 30;
    this.reviewThreshold = options.reviewThreshold ?? 20;
  }

  evaluate(job: JobOpportunity, profile: CandidateProfile): DeterministicMatchResult {
    const normalizedText = normalize(`${job.title}\n${job.description}`);
    const normalizedTitle = normalize(job.title);
    const evidence: MatchEvidence[] = [];

    const matchedSkills = profile.skills.filter((skill) => containsSkill(normalizedText, skill));
    const missingSkills = profile.skills.filter((skill) => !containsSkill(normalizedText, skill));

    for (const skill of matchedSkills) {
      evidence.push({ type: "SKILL_MATCH", detail: `Candidate skill is relevant to the job and appears in the posting: ${skill}` });
    }
    for (const skill of missingSkills) {
      evidence.push({ type: "SKILL_GAP", detail: `Candidate skill is not mentioned in the posting: ${skill}` });
    }

    const titleMatch = profile.targetTitles.some((title) => containsPhrase(normalizedTitle, normalize(title)));
    if (titleMatch) evidence.push({ type: "TITLE_MATCH", detail: "Job title matches a candidate target title." });

    const roleFit = assessRoleFit(normalizedTitle, normalizedText);
    if (!roleFit.allowed) {
      evidence.push({ type: "HARD_BLOCKER", detail: roleFit.reason });
      return { matchScore: 0, decision: "REJECT", matchedSkills, missingSkills, evidence, reason: roleFit.reason };
    }
    evidence.push({ type: "ROLE_FIT", detail: roleFit.reason });

    const requiredYears = extractRequiredYears(normalizedText);
    if (requiredYears !== null) {
      if (requiredYears > profile.yearsExperience) {
        evidence.push({ type: "HARD_BLOCKER", detail: `Job explicitly requires approximately ${requiredYears}+ years; candidate has ${profile.yearsExperience}.` });
        return { matchScore: 0, decision: "REJECT", matchedSkills, missingSkills, evidence, reason: "Deterministic hard blocker: explicit minimum experience exceeds candidate experience." };
      }
      evidence.push({ type: "EXPERIENCE", detail: `Candidate meets the explicit ${requiredYears}+ year requirement.` });
    }

    const skillScore = Math.min(70, matchedSkills.length * 14);
    const titleBonus = titleMatch ? 20 : 0;
    const roleBonus = roleFit.frontendSignal ? 10 : 0;
    const experienceBonus = requiredYears !== null && requiredYears <= profile.yearsExperience ? 10 : 0;
    const locationBonus = preferredLocation(job.location, job.country) ? 5 : 0;
    if (locationBonus > 0) evidence.push({ type: "LOCATION", detail: "Job location is aligned with Bengaluru/India/remote preferences." });

    const matchScore = Math.min(100, skillScore + titleBonus + roleBonus + experienceBonus + locationBonus);
    let decision: JobDecision = matchScore >= this.applyThreshold ? "APPLY" : matchScore >= this.reviewThreshold ? "REVIEW" : "REJECT";

    if (decision === "REJECT" && hasPreferredExperience(normalizedText) && (titleMatch || matchedSkills.length > 0)) decision = "REVIEW";

    return {
      matchScore,
      decision,
      matchedSkills,
      missingSkills,
      evidence,
      reason: `${matchedSkills.length} candidate skills appear in the job posting; ${titleMatch ? "target title matched" : "target title not matched"}; ${roleFit.reason}.`
    };
  }
}

function assessRoleFit(title: string, text: string): { allowed: boolean; frontendSignal: boolean; reason: string } {
  if (EXCLUDED_ROLE_TITLE.test(title)) {
    return { allowed: false, frontendSignal: false, reason: "Role title is outside the candidate's frontend/full-stack target." };
  }

  const frontendSignal = FRONTEND_ROLE_SIGNAL.test(title) || STRONG_FRONTEND_SIGNAL.test(text);
  if (BACKEND_ONLY_TITLE.test(title) && !/\breact|next\.js|nextjs|frontend|front-end|front end\b/i.test(text)) {
    return { allowed: false, frontendSignal: false, reason: "Backend-only role has no meaningful React/Next.js/frontend signal." };
  }

  if (!frontendSignal) {
    return { allowed: false, frontendSignal: false, reason: "Posting does not contain a meaningful frontend/React/full-stack signal." };
  }

  return { allowed: true, frontendSignal: true, reason: "Posting contains a meaningful frontend/React/full-stack signal." };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}

function compact(value: string): string {
  return value.replace(/[^a-z0-9]+/g, "");
}

function containsPhrase(text: string, term: string): boolean {
  if (!term) return false;
  return (` ${text} `).includes(` ${term} `);
}

function containsSkill(text: string, skill: string): boolean {
  const normalizedSkill = normalize(skill);
  const aliases = SKILL_ALIASES[normalizedSkill] ?? [normalizedSkill];
  const compactText = compact(text);
  return aliases.some((alias) => {
    const normalizedAlias = normalize(alias);
    return containsPhrase(text, normalizedAlias) || compactText.includes(compact(normalizedAlias));
  });
}

function preferredLocation(location: string | null, country: string | null): boolean {
  const value = normalize(`${location ?? ""} ${country ?? ""}`);
  return /\bbengaluru\b|\bbangalore\b|\bindia\b|\bremote\b/.test(value);
}

function hasPreferredExperience(text: string): boolean {
  return /\d+(?:\.\d+)?\s*\+?\s*years?(?:\s+of)?\s+experience\s+(?:preferred|desired|nice\s+to\s+have)/.test(text);
}

function extractRequiredYears(text: string): number | null {
  const matches = [
    ...text.matchAll(/(?:minimum|at least|required|must have)\s+(\d+(?:\.\d+)?)\s*\+?\s*years?(?:\s+of)?\s+experience/g),
    ...text.matchAll(/(\d+(?:\.\d+)?)\s*\+\s*years?\s+(?:of\s+)?experience\s+(?:required|mandatory|minimum)/g),
    ...text.matchAll(/(?:experience|exp)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*\+\s*years?/g)
  ];
  const years = matches.map((match) => Number(match[1])).filter((value) => Number.isFinite(value));
  return years.length > 0 ? Math.max(...years) : null;
}
