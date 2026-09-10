export interface CandidateProfileLike {
  targetRoles?: string[];
  skills?: string[];
  yearsExperience?: number;
  seniority?: string;
  preferredLocations?: string[];
  remoteEligible?: boolean;
}

export interface RecruiterRoleMatch {
  roleTerms: string[];
  recruiterTerms: string[];
  seniorityScore: number;
  experienceScore: number;
  locationScore: number;
  score: number;
}

const ROLE_TERMS = [
  "frontend developer", "frontend engineer", "react developer", "react engineer",
  "react.js developer", "next.js developer", "next.js engineer", "javascript developer",
  "typescript developer", "ui engineer", "ui developer", "web developer", "full stack developer",
  "full stack engineer", "software engineer", "software development engineer", "sde",
  "software engineer frontend", "software engineer react", "software engineer javascript",
  "software developer frontend",
];

const RECRUITER_TERMS = [
  "technical recruiter", "it recruiter", "technology recruiter", "software recruiter",
  "engineering recruiter", "talent acquisition", "technical talent acquisition",
  "talent partner", "engineering talent partner", "technical sourcer",
  "engineering sourcer", "recruiting", "recruitment", "hiring manager",
];

const normalize = (value: string) => value.toLowerCase().replace(/[.\-_/]+/g, " ").replace(/\s+/g, " ").trim();

export class ProactiveRecruiterRoleMatcher {
  constructor(private readonly configuredRoleTerms: string[] = ROLE_TERMS) {}

  buildTargetTerms(profile: CandidateProfileLike): string[] {
    const configured = profile.targetRoles ?? [];
    const skills = (profile.skills ?? []).map(normalize);
    const generated = [
      ...this.configuredRoleTerms,
      ...configured,
      ...skills,
      ...skills.filter((s) => ["react", "next js", "typescript", "javascript"].includes(s)).map((s) => `${s} developer`),
    ];
    return [...new Set(generated.map(normalize).filter(Boolean))];
  }

  match(profile: CandidateProfileLike, recruiterTitle: string, evidenceText = ""): RecruiterRoleMatch {
    const haystack = normalize(`${recruiterTitle} ${evidenceText}`);
    const roleTerms = this.buildTargetTerms(profile).filter((term) => haystack.includes(term));
    const recruiterTerms = RECRUITER_TERMS.filter((term) => haystack.includes(term));
    const seniorityScore = seniorityRelevance(profile, haystack);
    const experienceScore = experienceRelevance(profile, haystack);
    const locationScore = locationRelevance(profile, haystack);
    if (roleTerms.length === 0) return { roleTerms, recruiterTerms, seniorityScore, experienceScore, locationScore, score: 0 };
    const roleScore = Math.min(100, roleTerms.length * 25);
    const recruiterScore = Math.min(100, recruiterTerms.length * 20);
    const score = Math.round(roleScore * 0.6 + recruiterScore * 0.15 + seniorityScore * 0.1 + experienceScore * 0.05 + locationScore * 0.1);
    return { roleTerms, recruiterTerms, seniorityScore, experienceScore, locationScore, score };
  }
}

function seniorityRelevance(profile: CandidateProfileLike, evidence: string): number {
  const years = profile.yearsExperience ?? 0;
  const explicit = normalize(profile.seniority ?? "");
  if (/senior|lead|staff|principal/.test(evidence)) return years >= 4 || /senior|lead|staff|principal/.test(explicit) ? 100 : 45;
  if (/junior|entry level|graduate|fresher/.test(evidence)) return years <= 2 ? 100 : 35;
  if (/mid|intermediate|software engineer|developer/.test(evidence)) return years >= 2 && years < 6 ? 90 : 65;
  return 60;
}

function experienceRelevance(profile: CandidateProfileLike, evidence: string): number {
  const years = profile.yearsExperience ?? 0;
  const range = evidence.match(/(\d+)\s*\+?\s*years?/);
  if (!range) return 60;
  const required = Number(range[1]);
  if (!Number.isFinite(required)) return 60;
  return years >= required ? 100 : Math.max(0, 100 - (required - years) * 25);
}

function locationRelevance(profile: CandidateProfileLike, evidence: string): number {
  const locations = (profile.preferredLocations ?? []).map(normalize).filter(Boolean);
  if (locations.some((location) => evidence.includes(location))) return 100;
  if (profile.remoteEligible && /remote|india/.test(evidence)) return 90;
  return 50;
}

export const DEFAULT_RECRUITER_ROLE_TERMS = RECRUITER_TERMS;
