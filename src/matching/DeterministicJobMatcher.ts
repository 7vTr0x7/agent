import { JobOpportunity } from "../jobs/domain/JobOpportunity";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobDecision } from "../shared/types/job";
import { PERMANENTLY_EXCLUDED_COMPANIES } from "../applications/ApplicationPolicy";

export type MatchGeography = "BENGALURU" | "INDIA_OTHER" | "REMOTE_INDIA_ELIGIBLE" | "REMOTE_WORLDWIDE" | "REMOTE_RESTRICTED" | "FOREIGN_ONSITE" | "FOREIGN_HYBRID" | "UNKNOWN";
export type MatchFreshness = "VERY_RECENT" | "RECENT" | "MODERATELY_OLD" | "STALE" | "HISTORICAL" | "UNKNOWN";
export type MatchSeniority = "JUNIOR_ASSOCIATE" | "MID" | "SENIOR_COMPATIBLE" | "SENIOR_HIGH" | "LEAD" | "STAFF" | "PRINCIPAL" | "MANAGER" | "UNKNOWN";
export type TechnicalOrientation = "REACT_WEB" | "FRONTEND" | "FULL_STACK" | "REACT_NATIVE" | "BACKEND_FOCUSED" | "UNRELATED" | "UNKNOWN";

export interface MatchEvidence { type: "SKILL_MATCH" | "SKILL_GAP" | "TITLE_MATCH" | "EXPERIENCE" | "HARD_BLOCKER" | "ROLE_FIT" | "LOCATION" | "SENIORITY" | "FRESHNESS" | "SALARY"; detail: string; }
export interface DeterministicMatchResult { matchScore: number; decision: JobDecision; matchedSkills: string[]; missingSkills: string[]; evidence: MatchEvidence[]; reason: string; geography: MatchGeography; freshness: MatchFreshness; seniority: MatchSeniority; technicalOrientation: TechnicalOrientation; }
export interface DeterministicMatcherOptions { applyThreshold?: number; reviewThreshold?: number; now?: Date; }

const ALIASES: Record<string, string[]> = {
  react: ["react", "reactjs", "react.js"], "react.js": ["react", "reactjs", "react.js"],
  nextjs: ["next", "nextjs", "next.js", "next js"], "next.js": ["next", "nextjs", "next.js", "next js"],
  node: ["node", "nodejs", "node.js", "node js"], "node.js": ["node", "nodejs", "node.js", "node js"],
  express: ["express", "expressjs", "express.js", "express js"], "express.js": ["express", "expressjs", "express.js", "express js"],
  javascript: ["javascript", "js", "ecmascript"], js: ["javascript", "js", "ecmascript"],
  typescript: ["typescript", "ts"], ts: ["typescript", "ts"],
  "redux toolkit": ["redux toolkit", "@reduxjs/toolkit"], redux: ["redux", "redux toolkit", "@reduxjs/toolkit"],
  "tailwind css": ["tailwind css", "tailwind"], tailwind: ["tailwind css", "tailwind"],
  mongodb: ["mongodb", "mongo db", "mongo"], "react testing library": ["react testing library", "rtl"], rtl: ["react testing library", "rtl"],
  postgresql: ["postgresql", "postgres", "postgre sql"], postgres: ["postgresql", "postgres", "postgre sql"]
};
const FRONTEND_TITLE = /\b(frontend|front-end|front end|ui developer|ui engineer|web developer|web engineer|react developer|react engineer|next\.js developer|nextjs developer)\b/i;
const FULL_STACK_TITLE = /\b(full[- ]stack|fullstack|product engineer)\b/i;
const EXCLUDED_TITLE = /\b(product marketing|marketing|sales|account executive|business development|finance|accounting|legal|procurement|recruiter|talent acquisition|customer support|technical support|qa engineer|quality assurance|devops|site reliability|sre|network engineer|data analyst|data scientist|machine learning engineer|ml engineer|ai engineer|security engineer)\b/i;
const BACKEND_TITLE = /\b(backend|back-end|back end|java developer|python developer|\.net developer|golang developer|database administrator|dba|platform engineer|infrastructure engineer)\b/i;
const NATIVE_TITLE = /\breact native\b|\bmobile developer\b|\bmobile engineer\b|\bandroid developer\b|\bios developer\b|\bexpo\b/i;
const MANAGER_TITLE = /\b(manager|head of engineering|engineering manager)\b/i;
const PRINCIPAL_TITLE = /\bprincipal\b/i;
const STAFF_TITLE = /\bstaff\b/i;
const LEAD_TITLE = /\blead\b/i;
const COMPETING_FRAMEWORK = /\b(vue(?:\.js)?|angular(?:\.js)?|svelte(?:\.js)?|ember(?:\.js)?|solid(?:\.js)?)\b/i;
const COMPETING_PRIMARY = /\b(?:deep knowledge of|deep expertise in|expert(?:ise)? in|primary (?:frontend )?framework(?: is|:)?|must have|must be proficient in|strong experience with|extensive experience with)\s+(?:vue(?:\.js)?|angular(?:\.js)?|svelte(?:\.js)?|ember(?:\.js)?|solid(?:\.js)?)\b/i;
const RESTRICTED_REMOTE = /\b(?:remote|work from home|wfh)\s*(?:[-,:()]\s*)?(?:in|from|within)?\s*(?:the\s+)?(?:usa|u\.s\.a?\.?|united states(?: of america)?|uk|u\.k\.?|united kingdom|canada|australia)\b|\b(?:usa|united states|uk|united kingdom|canada|australia)\s+(?:only|based|based only)\b|\b(?:only|must be based in|based in)\s+(?:the\s+)?(?:usa|united states|uk|united kingdom|canada|australia)\b|\bremote\s+within\s+(?:the\s+)?(?:eu|european union)\b/i;
const FOREIGN_LOCATION = /\b(?:usa|u\.s\.a?\.?|united states|uk|u\.k\.?|united kingdom|canada|australia|germany|berlin|france|paris|poland|ukraine|philippines|brazil|europe|eastern europe)\b/i;

export class DeterministicJobMatcher {
  private readonly applyThreshold: number;
  private readonly reviewThreshold: number;
  private readonly now: () => Date;
  constructor(options: DeterministicMatcherOptions = {}) {
    this.applyThreshold = options.applyThreshold ?? 60;
    this.reviewThreshold = options.reviewThreshold ?? 42;
    const fixedNow = options.now;
    this.now = fixedNow ? () => new Date(fixedNow) : () => new Date();
  }

  evaluate(job: JobOpportunity, profile: CandidateProfile): DeterministicMatchResult {
    const title = normalize(job.title);
    const text = normalize(`${job.title}\n${job.description}`);
    const evidence: MatchEvidence[] = [];
    const matchedSkills = profile.skills.filter((skill) => containsSkill(text, skill));
    const missingSkills = profile.skills.filter((skill) => !containsSkill(text, skill));
    matchedSkills.forEach((skill) => evidence.push({ type: "SKILL_MATCH", detail: `Candidate skill appears in the posting: ${skill}` }));
    missingSkills.forEach((skill) => evidence.push({ type: "SKILL_GAP", detail: `Candidate skill is not mentioned in the posting: ${skill}` }));
    const titleMatch = profile.targetTitles.some((target) => containsPhrase(title, normalize(target)));
    if (titleMatch) evidence.push({ type: "TITLE_MATCH", detail: "Job title matches a candidate target title." });

    const geography = classifyGeography(job);
    const freshness = classifyFreshness(job.postedAt, this.now());
    const seniority = classifySeniority(title, text, profile.yearsExperience);
    const technicalOrientation = classifyTechnicalOrientation(title, text);
    const reject = (reason: string): DeterministicMatchResult => ({ matchScore: 0, decision: "REJECT", matchedSkills, missingSkills, evidence: [...evidence, { type: "HARD_BLOCKER", detail: reason }], reason, geography, freshness, seniority, technicalOrientation });

    if (EXCLUDED_TITLE.test(title)) return reject("Role title is outside the candidate's frontend/full-stack target.");
    if (PERMANENTLY_EXCLUDED_COMPANIES.some((company) => company.trim().toLowerCase() === job.companyName.trim().toLowerCase())) return reject("Company is permanently excluded by application policy.");
    if (geography === "FOREIGN_ONSITE" || geography === "FOREIGN_HYBRID") return reject("Foreign onsite/hybrid role is outside the candidate's geography target.");
    if (geography === "REMOTE_RESTRICTED") return reject("Remote posting explicitly restricts eligibility outside India.");
    if (freshness === "HISTORICAL") return reject("Posting is historical and lacks evidence that it remains current.");
    if (seniority === "MANAGER" || seniority === "PRINCIPAL") return reject(`Role seniority (${seniority}) is materially above the candidate's experience.`);

    const requiredYears = extractRequiredYears(text);
    const experienceRange = extractExperienceRange(text);
    if (requiredYears !== null && requiredYears >= 7) return reject("Explicit 7+ year experience requirement is incompatible with the candidate profile.");
    if (experienceRange && experienceRange.min >= 7) return reject("Explicit 7+ year experience range is incompatible with the candidate profile.");
    if (technicalOrientation === "REACT_NATIVE") return reject("React Native/mobile is the primary technical orientation and is not equivalent to React web experience.");
    if (technicalOrientation === "UNRELATED") return reject("Posting is not meaningfully aligned with the candidate's frontend/full-stack React target.");
    if (competingFrameworkIsPrimary(text)) return reject("A competing frontend framework is explicit/primary without sufficient React or Next.js core requirements.");

    if (requiredYears !== null || experienceRange) evidence.push({ type: "EXPERIENCE", detail: `Detected experience requirement: ${experienceRange ? `${experienceRange.min}-${experienceRange.max}` : `${requiredYears}+`} years.` });
    if (seniority !== "UNKNOWN") evidence.push({ type: "SENIORITY", detail: `Detected seniority: ${seniority}.` });
    evidence.push({ type: "LOCATION", detail: `Detected geography: ${geography}.` }, { type: "FRESHNESS", detail: `Detected freshness: ${freshness}.` });
    const salary = salaryAdjustment(job.description, profile);
    if (salary !== null) evidence.push({ type: "SALARY", detail: salary < 0 ? "Explicit salary appears materially below configured compensation." : "Explicit salary is not materially adverse." });

    let score = titleScore(title, technicalOrientation, titleMatch);
    score += Math.min(30, Math.round((matchedSkills.length / Math.max(1, Math.min(profile.skills.length, 8))) * 30));
    score += seniorityScore(seniority, requiredYears, profile.yearsExperience);
    score += geographyScore(geography);
    score += freshnessScore(freshness);
    score += salary ?? 0;
    if (technicalOrientation === "BACKEND_FOCUSED") score -= 25;
    if (geography === "REMOTE_WORLDWIDE") score -= 8;
    if (geography === "UNKNOWN") score -= 12;
    if (freshness === "STALE") score -= 25;
    if (freshness === "MODERATELY_OLD") score -= 10;
    if (seniority === "SENIOR_HIGH" || seniority === "LEAD" || seniority === "STAFF") score -= 18;
    if (seniority === "SENIOR_COMPATIBLE") score -= 4;
    score = Math.max(0, Math.min(100, Math.round(score)));
    let decision: JobDecision = score >= this.applyThreshold ? "APPLY" : score >= this.reviewThreshold ? "REVIEW" : "REJECT";
    const riskReview = (salary !== null && salary < 0) || geography === "REMOTE_WORLDWIDE" || geography === "UNKNOWN" || seniority === "SENIOR_HIGH" || seniority === "LEAD" || seniority === "STAFF" || technicalOrientation === "BACKEND_FOCUSED" || experienceMismatch(requiredYears, experienceRange, profile.yearsExperience);
    if (riskReview && decision === "APPLY") decision = "REVIEW";
    if (freshness === "STALE" && decision !== "REJECT") decision = "REVIEW";

    return { matchScore: score, decision, matchedSkills, missingSkills, evidence, reason: `${matchedSkills.length} skills matched; role=${technicalOrientation}; geography=${geography}; seniority=${seniority}; freshness=${freshness}.`, geography, freshness, seniority, technicalOrientation };
  }
}

function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim(); }
function compact(value: string): string { return normalize(value).replace(/[^a-z0-9]+/g, ""); }
function containsPhrase(text: string, term: string): boolean { return Boolean(term) && (` ${text} `).includes(` ${term} `); }
function containsSkill(text: string, skill: string): boolean { const normalized = normalize(skill); const aliases = ALIASES[normalized] ?? [normalized]; return aliases.some((alias) => containsPhrase(text, normalize(alias)) || compact(text).includes(compact(alias))); }
function classifyTechnicalOrientation(title: string, text: string): TechnicalOrientation {
  if (NATIVE_TITLE.test(title) || /\b(?:primary|mainly|mostly|focused on)\s+(?:react native|mobile)\b/i.test(text)) return "REACT_NATIVE";
  if (BACKEND_TITLE.test(title) && !FULL_STACK_TITLE.test(title)) return "BACKEND_FOCUSED";
  if (/\bbackend[- ]focused\b|\bbackend[- ]heavy\b|\bprimarily backend\b|\bbackend architecture\b|\bapi platform\b|\bmicroservices\b|\bdistributed systems\b|\bbackend integrations?\b|\bapi-based systems\b|\bmessage queues?\b|\bnode\.js backend\b|\bbackend engineer\b/i.test(text)) return "BACKEND_FOCUSED";
  const web = /\b(react|reactjs|react\.js|next\.js|nextjs|next js|frontend|front-end|front end|web ui|user interface)\b/i.test(title) || /\b(react|reactjs|react\.js|next\.js|nextjs|next js|frontend|front-end|front end|web ui|user interface)\b/i.test(text);
  if (!web) return "UNRELATED";
  if (FULL_STACK_TITLE.test(title)) return "FULL_STACK";
  if (FRONTEND_TITLE.test(title)) return "REACT_WEB";
  return "FRONTEND";
}
function competingFrameworkIsPrimary(text: string): boolean { if (!COMPETING_FRAMEWORK.test(text)) return false; const react = (text.match(/\breact(?:\.js|js)?\b/gi) ?? []).length; const next = (text.match(/\bnext(?:\.js|js)?\b/gi) ?? []).length; return react + next === 0 || (COMPETING_PRIMARY.test(text) && react + next <= 2); }
function classifyGeography(job: JobOpportunity): MatchGeography {
  const location = normalize(`${job.location ?? ""} ${job.country ?? ""}`), description = normalize(job.description), all = `${location} ${normalize(job.title)} ${description}`;
  const remote = job.workplaceType === "remote" || /\bremote\b|\bwork from home\b|\bwfh\b/i.test(all);
  const india = /\bindia\b|\bindian\b/i.test(location) || /\bremote (?:in|from|within) india\b|\bindia[- ]eligible\b|\bindia based\b/i.test(description);
  const bengaluru = /\bbengaluru\b|\bbangalore\b/i.test(location);
  const restricted = RESTRICTED_REMOTE.test(all);
  const foreign = FOREIGN_LOCATION.test(location);
  if (bengaluru) return "BENGALURU";
  if (remote && india && !restricted) return "REMOTE_INDIA_ELIGIBLE";
  if (remote && restricted && !india) return "REMOTE_RESTRICTED";
  if (remote) return "REMOTE_WORLDWIDE";
  if (india) return "INDIA_OTHER";
  if (job.workplaceType === "onsite" && foreign) return "FOREIGN_ONSITE";
  if (job.workplaceType === "hybrid" && foreign) return "FOREIGN_HYBRID";
  return "UNKNOWN";
}
function classifyFreshness(postedAt: Date | null, now: Date): MatchFreshness { if (!postedAt) return "UNKNOWN"; const days = Math.max(0, (now.getTime() - postedAt.getTime()) / 86_400_000); if (days <= 7) return "VERY_RECENT"; if (days <= 30) return "RECENT"; if (days <= 90) return "MODERATELY_OLD"; if (days <= 365) return "STALE"; return "HISTORICAL"; }
function classifySeniority(title: string, text: string, years: number): MatchSeniority { if (MANAGER_TITLE.test(title)) return "MANAGER"; if (PRINCIPAL_TITLE.test(title)) return "PRINCIPAL"; if (STAFF_TITLE.test(title)) return "STAFF"; if (LEAD_TITLE.test(title)) return "LEAD"; const range = extractExperienceRange(text), required = extractRequiredYears(text); if (range) return range.max <= 4 && range.min <= years ? "SENIOR_COMPATIBLE" : "SENIOR_HIGH"; if (required !== null) return required >= 4 ? "SENIOR_HIGH" : "MID"; if (/\b(junior|jr\.?|associate|entry[- ]level)\b/i.test(title)) return "JUNIOR_ASSOCIATE"; if (/\bsenior\b/i.test(title)) return years >= 2 && years <= 4 ? "SENIOR_COMPATIBLE" : "SENIOR_HIGH"; if (/\b(mid|middle|intermediate)\b/i.test(title)) return "MID"; return "UNKNOWN"; }
function extractRequiredYears(text: string): number | null { const matches = [...text.matchAll(/(?:minimum|at least|required|must have)\s+(\d+(?:\.\d+)?)\s*\+?\s*years?(?:\s+of)?\s+experience/g), ...text.matchAll(/\b(\d+(?:\.\d+)?)\s*\+\s*years?\s+(?:of\s+)?(?:strong\s+)?(?:full[- ]stack\s+)?experience\b/g), ...text.matchAll(/\b(\d+(?:\.\d+)?)\s*\+\s*years?\s+(?:of\s+)?experience\s+(?:is\s+)?required\b/g), ...text.matchAll(/\b(\d+(?:\.\d+)?)\s*\+\s*years?\s+required\b/g)]; const values = matches.map((match) => Number(match[1])).filter(Number.isFinite); return values.length ? Math.max(...values) : null; }
function extractExperienceRange(text: string): { min: number; max: number } | null { const match = text.match(/\b(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*\+?\s*years?\b/); return match ? { min: Number(match[1]), max: Number(match[2]) } : null; }
function experienceMismatch(required: number | null, range: { min: number; max: number } | null, years: number): boolean { return (required !== null && required > years && required < 7) || (range !== null && range.min > years); }
function titleScore(title: string, orientation: TechnicalOrientation, titleMatch: boolean): number { if (FRONTEND_TITLE.test(title) || titleMatch) return 32; if (FULL_STACK_TITLE.test(title) || orientation === "FULL_STACK") return 27; return orientation === "FRONTEND" || orientation === "REACT_WEB" ? 24 : 20; }
function seniorityScore(seniority: MatchSeniority, required: number | null, years: number): number { if (seniority === "JUNIOR_ASSOCIATE" || seniority === "MID") return 15; if (seniority === "SENIOR_COMPATIBLE") return 12; if (seniority === "SENIOR_HIGH") return required !== null && required <= years ? 8 : 3; if (seniority === "LEAD" || seniority === "STAFF") return 2; if (seniority === "UNKNOWN") return 8; return 0; }
function geographyScore(geography: MatchGeography): number { return geography === "BENGALURU" ? 15 : geography === "INDIA_OTHER" ? 13 : geography === "REMOTE_INDIA_ELIGIBLE" ? 12 : geography === "REMOTE_WORLDWIDE" ? 6 : 0; }
function freshnessScore(freshness: MatchFreshness): number { return freshness === "VERY_RECENT" ? 10 : freshness === "RECENT" ? 8 : freshness === "MODERATELY_OLD" ? 4 : 0; }
function salaryAdjustment(description: string, profile: CandidateProfile): number | null { const target = profile.expectedCompensationLpa ?? profile.currentCompensationLpa; if (target === undefined) return null; const ranges = [...description.toLowerCase().matchAll(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*lpa/g)]; if (!ranges.length) return null; const max = Math.max(...ranges.map((match) => Number(match[2]))); return Number.isFinite(max) ? (max >= target * 0.9 ? 3 : -25) : null; }
