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
  score: number;
}

const ROLE_TERMS = [
  "frontend developer", "frontend engineer", "react developer", "react engineer",
  "react.js developer", "next.js developer", "next.js engineer", "javascript developer",
  "typescript developer", "ui engineer", "web developer", "full stack developer",
  "full stack engineer", "software engineer frontend", "software engineer react",
  "software engineer javascript", "software developer frontend",
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
      ...skills.filter((s) => ["react", "next js", "typescript", "javascript"].includes(s)).map((s) => `${s} developer`),
    ];
    return [...new Set(generated.map(normalize).filter(Boolean))];
  }

  match(profile: CandidateProfileLike, recruiterTitle: string, evidenceText = ""): RecruiterRoleMatch {
    const haystack = normalize(`${recruiterTitle} ${evidenceText}`);
    const roleTerms = this.buildTargetTerms(profile).filter((term) => haystack.includes(term));
    const recruiterTerms = RECRUITER_TERMS.filter((term) => haystack.includes(term));
    const score = Math.min(100, roleTerms.length * 25 + recruiterTerms.length * 10);
    return { roleTerms, recruiterTerms, score };
  }
}

export const DEFAULT_RECRUITER_ROLE_TERMS = RECRUITER_TERMS;
