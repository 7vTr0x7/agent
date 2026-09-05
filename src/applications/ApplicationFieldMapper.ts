import { ApplicationField } from "./FormFieldDetector";
import { CandidateProfile } from "../candidates/CandidateProfile";

export type ApplicationFieldKey =
  | "firstName"
  | "lastName"
  | "fullName"
  | "email"
  | "phone"
  | "location"
  | "workAuthorization"
  | "sponsorshipRequired"
  | "noticePeriodDays"
  | "yearsExperience"
  | "linkedinUrl"
  | "githubUrl"
  | "portfolioUrl"
  | "resumePath";

export interface ApplicationFieldMapping {
  field: ApplicationField;
  key: ApplicationFieldKey | null;
  value: string | boolean | number | null;
  confidence: number;
  autoFill: boolean;
  reason: string;
}

const FIELD_ALIASES: Readonly<Record<ApplicationFieldKey, readonly string[]>> = {
  firstName: ["first name", "firstname", "given name", "forename"],
  lastName: ["last name", "lastname", "surname", "family name"],
  fullName: ["full name", "name", "candidate name", "your name"],
  email: ["email", "email address", "e-mail", "e-mail address"],
  phone: ["phone", "phone number", "mobile", "mobile number", "telephone", "contact number"],
  location: ["location", "current location", "city", "current city", "address"],
  workAuthorization: ["work authorization", "work eligibility", "right to work", "authorized to work"],
  sponsorshipRequired: ["sponsorship", "visa sponsorship", "require sponsorship", "need sponsorship"],
  noticePeriodDays: ["notice period", "notice period days", "availability", "days to join"],
  yearsExperience: ["years of experience", "years experience", "experience", "total experience"],
  linkedinUrl: ["linkedin", "linkedin url", "linkedin profile", "linkedin profile url"],
  githubUrl: ["github", "github url", "github profile", "github profile url"],
  portfolioUrl: ["portfolio", "portfolio url", "personal website", "website"],
  resumePath: ["resume", "cv", "curriculum vitae", "resume upload", "cv upload"]
};

const UNSAFE_KEYS = new Set<ApplicationFieldKey>([
  "workAuthorization",
  "sponsorshipRequired",
  "noticePeriodDays",
  "yearsExperience"
]);

function normalize(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fieldText(field: ApplicationField): string {
  return normalize([field.label, field.name, field.placeholder].filter(Boolean).join(" "));
}

function resolveKey(field: ApplicationField): { key: ApplicationFieldKey | null; confidence: number } {
  const text = fieldText(field);
  if (!text) return { key: null, confidence: 0 };

  const matches = (Object.entries(FIELD_ALIASES) as [ApplicationFieldKey, readonly string[]][])
    .map(([key, aliases]) => ({
      key,
      score: aliases.reduce((best, alias) => {
        const normalizedAlias = normalize(alias);
        if (text === normalizedAlias) return Math.max(best, 1);
        if (text.includes(normalizedAlias)) return Math.max(best, 0.9);
        return best;
      }, 0)
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0) return { key: null, confidence: 0 };
  if (matches.length > 1 && matches[0].score === matches[1].score) {
    return { key: null, confidence: matches[0].score };
  }

  return { key: matches[0].key, confidence: matches[0].score };
}

function valueFor(profile: CandidateProfile, key: ApplicationFieldKey): string | boolean | number | null {
  if (key === "fullName") return profile.fullName ?? [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null;
  if (key === "resumePath") return profile.resumePath ?? null;
  return profile[key] ?? profile.standardizedAnswers?.[key] ?? null;
}

export class ApplicationFieldMapper {
  map(fields: readonly ApplicationField[], profile: CandidateProfile): readonly ApplicationFieldMapping[] {
    return fields.map((field) => {
      const { key, confidence } = resolveKey(field);
      if (!key) {
        return {
          field,
          key: null,
          value: null,
          confidence,
          autoFill: false,
          reason: field.required ? "Required field is ambiguous or unsupported; manual review required." : "Field is ambiguous or unsupported; skipped safely."
        };
      }

      const value = valueFor(profile, key);
      const autoFill = confidence >= 0.9 && value !== null && !UNSAFE_KEYS.has(key);
      const reason = value === null
        ? "No candidate value is configured for this field."
        : autoFill
          ? "Deterministic field mapping with high confidence."
          : "Field requires policy-aware review before automatic filling.";

      return { field, key, value, confidence, autoFill, reason };
    });
  }
}
