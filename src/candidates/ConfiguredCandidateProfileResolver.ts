import { CandidateProfile } from "./CandidateProfile";

export interface CandidateProfileConfig {
  id: string;
  yearsExperience: number;
  skills: readonly string[];
  targetTitles: readonly string[];
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  workAuthorization?: string;
  sponsorshipRequired?: boolean;
  noticePeriodDays?: number;
  currentCompensationLpa?: number;
  expectedCompensationLpa?: number;
  linkedinUrl?: string;
  githubUrl?: string;
  portfolioUrl?: string;
  resumePath?: string;
  standardizedAnswers?: Readonly<Record<string, string | boolean | number>>;
}

export class ConfiguredCandidateProfileResolver {
  constructor(private readonly profile: CandidateProfile) {}

  async getById(candidateProfileId: string): Promise<CandidateProfile | null> {
    return candidateProfileId === this.profile.id ? this.profile : null;
  }

  static fromEnvironment(env: NodeJS.ProcessEnv = process.env): ConfiguredCandidateProfileResolver {
    const configuredCandidateEmail = optional(env, "CANDIDATE_EMAIL");
    const gmailUserEmail = optional(env, "GMAIL_USER_EMAIL");
    const gmailEnabled = env["GMAIL_ENABLED"] === "true";
    const candidateEmail = configuredCandidateEmail ?? (gmailEnabled ? gmailUserEmail : undefined);
    const standardizedAnswers = jsonAnswers(env);

    const profile: CandidateProfile = {
      id: required(env, "CANDIDATE_PROFILE_ID"),
      yearsExperience: positiveNumber(env, "CANDIDATE_YEARS_EXPERIENCE"),
      skills: csv(env, "CANDIDATE_SKILLS"),
      targetTitles: csv(env, "CANDIDATE_TARGET_TITLES"),
      firstName: optional(env, "CANDIDATE_FIRST_NAME"),
      lastName: optional(env, "CANDIDATE_LAST_NAME"),
      fullName: optional(env, "CANDIDATE_FULL_NAME"),
      email: candidateEmail,
      phone: optional(env, "CANDIDATE_PHONE"),
      location: optional(env, "CANDIDATE_LOCATION"),
      workAuthorization: optional(env, "CANDIDATE_WORK_AUTHORIZATION"),
      sponsorshipRequired: optionalBoolean(env, "CANDIDATE_SPONSORSHIP_REQUIRED"),
      noticePeriodDays: optionalNumber(env, "CANDIDATE_NOTICE_PERIOD_DAYS"),
      currentCompensationLpa: optionalNumber(env, "CANDIDATE_CURRENT_COMPENSATION_LPA"),
      expectedCompensationLpa: optionalNumber(env, "CANDIDATE_EXPECTED_COMPENSATION_LPA"),
      linkedinUrl: optional(env, "CANDIDATE_LINKEDIN_URL"),
      githubUrl: optional(env, "CANDIDATE_GITHUB_URL"),
      portfolioUrl: optional(env, "CANDIDATE_PORTFOLIO_URL"),
      resumePath: optional(env, "CANDIDATE_RESUME_PATH"),
      standardizedAnswers
    };

    return new ConfiguredCandidateProfileResolver(profile);
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value || undefined;
}

function csv(env: NodeJS.ProcessEnv, name: string): readonly string[] {
  const values = required(env, name).split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) throw new Error(`${name} must contain at least one value`);
  return values;
}

function positiveNumber(env: NodeJS.ProcessEnv, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function optionalNumber(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = optional(env, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function optionalBoolean(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const raw = optional(env, name);
  if (raw === undefined) return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function jsonAnswers(env: NodeJS.ProcessEnv): Readonly<Record<string, string | boolean | number>> | undefined {
  const raw = optional(env, "CANDIDATE_STANDARDIZED_ANSWERS_JSON");
  if (!raw) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch (error) { throw new Error(`CANDIDATE_STANDARDIZED_ANSWERS_JSON must be valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("CANDIDATE_STANDARDIZED_ANSWERS_JSON must be a JSON object.");
  const result: Record<string, string | boolean | number> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!["string", "boolean", "number"].includes(typeof value)) throw new Error(`CANDIDATE_STANDARDIZED_ANSWERS_JSON contains unsupported value for '${key}'.`);
    result[key] = value as string | boolean | number;
  }
  return result;
}
