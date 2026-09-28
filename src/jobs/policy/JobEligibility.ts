import { assessJobRisk } from "./JobRiskPolicy";

export type JobPriority = 1 | 2 | 3;
export type JobEligibilityDecision = "ELIGIBLE" | "REJECT";
export type JobRelevanceClassification = "TARGET" | "ADJACENT" | "AMBIGUOUS" | "IRRELEVANT";

export interface JobEligibilityInput {
  companyName: string;
  title?: string;
  description?: string;
  location: string | null;
  country: string | null;
  workplaceType: "onsite" | "remote" | "hybrid" | null;
  postedAt?: Date | null;
  now?: Date;
}

export interface JobSearchPolicy {
  priorityLocations: string[];
  targetCountry: string;
  allowRemote: boolean;
  excludedCompanies: string[];
  maxAgeDays: number;
  targetTitles?: string[];
  candidateSkills?: string[];
  yearsExperience?: number;
  minPersistenceRelevance?: number;
}

export interface JobEligibilityResult {
  decision: JobEligibilityDecision;
  priority: JobPriority | null;
  reason: string;
  score: number;
  classification: JobRelevanceClassification;
  matchedSignals: string[];
  negativeSignals: string[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
}
function normalizedCompact(value: string): string { return normalize(value).replace(/\s+/g, ""); }
function containsNormalized(value: string, target: string): boolean { return normalize(value).includes(normalize(target)); }
function isExcludedCompany(companyName: string, excludedCompanies: string[]): boolean { return excludedCompanies.some((excluded) => normalize(companyName) === normalize(excluded)); }

const TARGET_ROLE_PATTERNS: ReadonlyArray<[RegExp, number, string]> = [
  [/\b(frontend|front end|front-end)\s+(developer|engineer)\b/i, 40, "frontend role"],
  [/\breact(?:\.js)?\s+(developer|engineer)\b/i, 40, "react role"],
  [/\bnext(?:\.js)?\s+(developer|engineer)\b/i, 40, "next.js role"],
  [/\b(full[ -]?stack)\s+(developer|engineer)\b/i, 35, "full-stack role"],
  [/\b(mern|mean)\s+(stack\s+)?developer\b/i, 35, "full-stack javascript role"],
  [/\b(javascript|typescript)\s+(developer|engineer)\b/i, 35, "javascript/typescript role"],
  [/\bweb\s+(developer|engineer)\b/i, 30, "web role"],
  [/\bui\s+engineer\b/i, 30, "ui engineer role"],
  [/\bsoftware\s+engineer\s*[-–—:]?\s*(frontend|front end|react|web)\b/i, 40, "frontend software role"],
  [/\bsoftware\s+developer\s*[-–—:]?\s*(frontend|front end|react|web|full[ -]?stack)\b/i, 40, "frontend software role"]
];

const EXCLUDED_ROLE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(devops|site reliability|sre|network|data|ml|machine learning|ai|security|cybersecurity|cloud|infrastructure|platform|database|endpoint|windows|macos|linux|embedded|firmware|hardware)\s+(engineer|developer|architect|administrator|scientist)\b/i, "engineering role outside target domain"],
  [/\b(system|systems)\s+engineer\b/i, "systems engineer"],
  [/\bdata\s+scientist\b/i, "data scientist"],
  [/\bnetwork\s+administrator\b/i, "network administrator"],
  [/\b(sales|support|technical support|customer support|customer service)\s+(engineer|developer|specialist|representative|manager)\b/i, "support/sales occupation"],
  [/\b(engineering\s+)?(manager|director|head|vp|vice president|chief)\b/i, "engineering leadership role"],
  [/\b(staff|principal|distinguished)\s+(software|frontend|full[ -]?stack|web|react|javascript|typescript)?\s*engineer\b/i, "seniority beyond target experience"],
  [/\b(marketing|influencer|payroll|account(?:ing)?|customer success|recruiter|talent acquisition|human resources|hr|legal|operations|office|administration|chief of staff|project manager|program manager|product manager|business development|business operations|content writer|copywriter|course writer|education designer|graphic designer|social media|seo|pr|communications|construction|driver|warehouse|logistics|manufacturing|mechanical|electrical|civil|medical|nurse|doctor|teacher|professor|bookkeeper|bohrteam|baggerfahrer|lkw)\b/i, "unrelated occupation"]
];

const FRONTEND_SIGNALS: ReadonlyArray<[RegExp, number, string]> = [
  [/\breact(?:\.js)?\b/i, 30, "React"],
  [/\bnext(?:\.js)?\b/i, 25, "Next.js"],
  [/\btypescript\b/i, 20, "TypeScript"],
  [/\bjavascript\b|\bes6\b/i, 15, "JavaScript"],
  [/\bfront(?:end|[- ]end)\b/i, 15, "frontend"],
  [/\bweb\s+(application|app|development|developer|engineer)\b/i, 10, "web application"],
  [/\bhtml5?\b/i, 8, "HTML"],
  [/\bcss3?\b/i, 8, "CSS"],
  [/\bredux(?: toolkit)?\b/i, 10, "Redux"],
  [/\bnode(?:\.js)?\b/i, 10, "Node.js"],
  [/\bexpress(?:\.js)?\b/i, 10, "Express"],
  [/\bmern\b/i, 20, "MERN"],
  [/\b(rest|restful)\s+api\b/i, 8, "REST API"],
  [/\bgraphql\b/i, 8, "GraphQL"],
  [/\bui\b|user interface/i, 10, "UI"]
];

const FOREIGN_ONLY_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:us|usa|united states|u\.s\.)\s+only\b/i, "US only"],
  [/\b(?:canada|canadian)\s+only\b/i, "Canada only"],
  [/\b(?:uk|united kingdom|britain|great britain)\s+only\b/i, "UK only"],
  [/\b(?:eu|europe|european union)\s+only\b/i, "EU only"],
  [/\b(?:germany|france|australia|new zealand|japan|singapore|north america|europe)\s+only\b/i, "foreign geography only"],
  [/\b(?:must|need to|required to)\s+(?:be )?(?:located|based|resident)\s+in\s+(?:the\s+)?(?:us|usa|united states|canada|uk|united kingdom|germany|france|australia|new zealand|japan|singapore)\b/i, "foreign residence requirement"]
];

const LEADERSHIP_TITLE_PATTERN = /\b(staff|principal|distinguished|architect|director|head|vp|vice president|chief|manager)\b/i;
const SENIOR_EXPERIENCE_PATTERN = /\b(?:10|11|12|13|14|15|16|17|18|19|20)\+?\s+years?\b/i;
const MODERATE_SENIOR_EXPERIENCE_PATTERN = /\b([4-9])\+?\s+years?\b/i;

function classifyRole(title: string, description: string, policy: JobSearchPolicy): { classification: JobRelevanceClassification; score: number; matchedSignals: string[]; negativeSignals: string[] } {
  const titleText = normalize(title);
  const body = `${title}\n${description}`;
  const matchedSignals: string[] = [];
  const negativeSignals: string[] = [];
  let score = 0;

  for (const [pattern, weight, signal] of TARGET_ROLE_PATTERNS) if (pattern.test(title)) { score = Math.max(score, weight); matchedSignals.push(signal); }
  for (const targetTitle of policy.targetTitles ?? []) {
    const normalizedTarget = normalizedCompact(targetTitle);
    if (normalizedTarget && normalizedCompact(title).includes(normalizedTarget)) { score = Math.max(score, 45); matchedSignals.push(`configured target title: ${targetTitle}`); }
  }
  for (const [pattern, signal] of EXCLUDED_ROLE_PATTERNS) if (pattern.test(titleText)) negativeSignals.push(signal);
  for (const [pattern, weight, signal] of FRONTEND_SIGNALS) if (pattern.test(body)) { score += weight; matchedSignals.push(signal); }
  for (const skill of policy.candidateSkills ?? []) {
    const normalizedSkill = normalizedCompact(skill);
    if (normalizedSkill && normalizedCompact(body).includes(normalizedSkill) && !matchedSignals.includes(skill)) { score += 5; matchedSignals.push(`candidate skill: ${skill}`); }
  }

  const genericSoftware = /\b(software engineer|software developer|application developer)\b/i.test(title);
  const fullStack = /\b(full[ -]?stack|mern)\b/i.test(title);
  const strongFrontendEvidence = matchedSignals.some((signal) => ["React", "Next.js", "TypeScript", "JavaScript", "frontend", "web application", "MERN"].includes(signal) || signal.startsWith("candidate skill: React") || signal.startsWith("candidate skill: Next"));
  const explicitTarget = TARGET_ROLE_PATTERNS.some(([pattern]) => pattern.test(title)) || (policy.targetTitles ?? []).some((target) => normalizedCompact(title).includes(normalizedCompact(target)));

  if (genericSoftware && !strongFrontendEvidence && !explicitTarget) return { classification: "AMBIGUOUS", score, matchedSignals, negativeSignals };
  if (fullStack && !strongFrontendEvidence) return { classification: "AMBIGUOUS", score, matchedSignals, negativeSignals };
  if (negativeSignals.length > 0 && !strongFrontendEvidence && !explicitTarget) return { classification: "IRRELEVANT", score: Math.min(score, 10), matchedSignals, negativeSignals };
  const threshold = policy.minPersistenceRelevance ?? 45;
  if (explicitTarget || score >= threshold) return { classification: "TARGET", score, matchedSignals, negativeSignals };
  if (strongFrontendEvidence && score >= Math.max(40, threshold - 10)) return { classification: "ADJACENT", score, matchedSignals, negativeSignals };
  return { classification: "AMBIGUOUS", score, matchedSignals, negativeSignals };
}

function geographyAllowed(job: JobEligibilityInput, policy: JobSearchPolicy): { allowed: boolean; priority: JobPriority | null; reason?: string; negativeSignals: string[] } {
  const location = normalize(job.location ?? "");
  const country = normalize(job.country ?? "");
  const description = normalize(job.description ?? "");
  const combined = `${location} ${country} ${description}`;
  const negativeSignals: string[] = [];
  for (const [pattern, signal] of FOREIGN_ONLY_PATTERNS) if (pattern.test(combined)) negativeSignals.push(signal);

  const india = country === normalize(policy.targetCountry) || containsNormalized(location, policy.targetCountry);
  const priorityLocation = policy.priorityLocations.some((target) => containsNormalized(location, target));
  const remote = job.workplaceType === "remote" || /\b(remote|work from home|wfh)\b/i.test(location);
  const worldwide = /\b(worldwide|global|anywhere|international)\b/i.test(combined);

  if (negativeSignals.length > 0) return { allowed: false, priority: null, reason: `Explicit geographic restriction excludes India: ${negativeSignals.join(", ")}.`, negativeSignals };
  if (priorityLocation && india) return { allowed: true, priority: 1, negativeSignals };
  if (priorityLocation) return { allowed: true, priority: 1, negativeSignals };
  if (india) return { allowed: true, priority: 2, negativeSignals };
  if (remote && policy.allowRemote && (worldwide || !country || country === "remote" || /\bindia\b/i.test(combined))) return { allowed: true, priority: 3, negativeSignals };
  return { allowed: false, priority: null, reason: "Role is outside the candidate's India/remote geography policy.", negativeSignals };
}

function seniorityAllowed(title: string, description: string, yearsExperience: number): { allowed: boolean; reason?: string; negativeSignals: string[] } {
  const negativeSignals: string[] = [];
  if (LEADERSHIP_TITLE_PATTERN.test(title)) return { allowed: false, reason: "Role is a leadership/staff-level position beyond the candidate's target experience.", negativeSignals: ["leadership/staff title"] };
  if (SENIOR_EXPERIENCE_PATTERN.test(`${title}\n${description}`)) return { allowed: false, reason: "Role requires substantially more experience than the candidate profile.", negativeSignals: ["10+ years experience"] };
  const moderate = MODERATE_SENIOR_EXPERIENCE_PATTERN.exec(`${title}\n${description}`);
  if (moderate && Number(moderate[1]) >= Math.max(5, yearsExperience + 2)) return { allowed: false, reason: `Role explicitly requires ${moderate[1]}+ years, materially above the candidate profile.`, negativeSignals: [`${moderate[1]}+ years experience`] };
  return { allowed: true, negativeSignals };
}

function baseResult(overrides: Partial<JobEligibilityResult>): JobEligibilityResult {
  return { decision: "REJECT", priority: null, reason: "Job did not satisfy the relevance policy.", score: 0, classification: "IRRELEVANT", matchedSignals: [], negativeSignals: [], ...overrides };
}

function isTooOld(job: JobEligibilityInput, policy: JobSearchPolicy, now: Date): boolean {
  if (policy.maxAgeDays <= 0 || !job.postedAt) return false;
  const postedAt = job.postedAt.getTime();
  if (!Number.isFinite(postedAt)) return true;
  const ageMs = now.getTime() - postedAt;
  if (ageMs < 0) return true;
  return ageMs > policy.maxAgeDays * 24 * 60 * 60 * 1000;
}

export function evaluateJobEligibility(job: JobEligibilityInput, policy: JobSearchPolicy): JobEligibilityResult {
  const now = job.now ?? new Date();
  if (!job.companyName.trim()) return baseResult({ reason: "Job has no company name.", negativeSignals: ["missing company"] });
  if (!job.title?.trim()) return baseResult({ reason: "Job has no title.", negativeSignals: ["missing title"] });
  if (isExcludedCompany(job.companyName, policy.excludedCompanies)) return baseResult({ reason: "Company is explicitly excluded from applications.", negativeSignals: ["excluded company"] });
  if (isTooOld(job, policy, now)) return baseResult({ reason: `Job is older than the configured ${policy.maxAgeDays}-day freshness window or has a future posted date.`, negativeSignals: ["stale/future posting"] });

  const risk = assessJobRisk({ title: job.title ?? "", companyName: job.companyName, description: job.description ?? "" });
  if (risk.level === "HIGH") return baseResult({ reason: `Job was rejected by the safety-risk policy: ${risk.reasons.join(" ")}`, negativeSignals: risk.reasons });

  const relevance = classifyRole(job.title, job.description ?? "", policy);
  const geography = geographyAllowed(job, policy);
  const seniority = seniorityAllowed(job.title, job.description ?? "", policy.yearsExperience ?? 3);
  const negativeSignals = [...relevance.negativeSignals, ...geography.negativeSignals, ...seniority.negativeSignals];

  if (relevance.classification === "IRRELEVANT") return baseResult({ reason: "Role is outside the candidate's target engineering domain.", score: relevance.score, classification: relevance.classification, matchedSignals: relevance.matchedSignals, negativeSignals });
  if (!geography.allowed) return baseResult({ reason: geography.reason ?? "Geography is outside the candidate policy.", score: relevance.score, classification: relevance.classification, matchedSignals: relevance.matchedSignals, negativeSignals });
  if (!seniority.allowed) return baseResult({ reason: seniority.reason ?? "Seniority is outside the candidate policy.", score: relevance.score, classification: relevance.classification, matchedSignals: relevance.matchedSignals, negativeSignals });
  if (relevance.classification === "AMBIGUOUS" && relevance.score < (policy.minPersistenceRelevance ?? 45)) return baseResult({ reason: "Insufficient frontend/full-stack evidence for an ambiguous engineering role.", score: relevance.score, classification: relevance.classification, matchedSignals: relevance.matchedSignals, negativeSignals });

  const warning = risk.level === "MEDIUM" ? " Medium-risk warning retained for matcher review." : "";
  return { decision: "ELIGIBLE", priority: geography.priority, reason: `${relevance.classification} role with ${relevance.matchedSignals.length} matched signals.${warning}`, score: relevance.score, classification: relevance.classification, matchedSignals: relevance.matchedSignals, negativeSignals };
}
