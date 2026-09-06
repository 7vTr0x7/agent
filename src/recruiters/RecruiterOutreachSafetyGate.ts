import { PERMANENTLY_EXCLUDED_COMPANIES } from "../applications/ApplicationPolicy";
import { RecruiterContactCandidate } from "./RecruiterDiscovery";

export interface RecruiterOutreachSafetyInput {
  companyName: string;
  companyDomain: string;
  contact: RecruiterContactCandidate;
  minConfidence: number;
  requireVerifiedEmail: boolean;
  suppressedEmail: boolean;
  suppressedDomain: boolean;
  duplicateSequence: boolean;
  dryRun: boolean;
}

export interface RecruiterOutreachSafetyResult {
  allowed: boolean;
  reason: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function evaluateRecruiterOutreachSafety(
  input: RecruiterOutreachSafetyInput
): RecruiterOutreachSafetyResult {
  const excluded = PERMANENTLY_EXCLUDED_COMPANIES.some(
    (company) => normalize(company) === normalize(input.companyName)
  );
  if (excluded) return { allowed: false, reason: "Company is permanently excluded from outreach." };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contact.email)) {
    return { allowed: false, reason: "Contact email has an invalid format." };
  }

  const emailDomain = normalize(input.contact.email.split("@").pop() ?? "");
  const companyDomain = normalize(input.companyDomain).replace(/^www\./, "");
  if (!emailDomain || emailDomain !== companyDomain) {
    return { allowed: false, reason: "Contact email is not on the employer domain." };
  }

  if (input.contact.email.includes("+") || /example\.(com|org|net)$/i.test(emailDomain)) {
    return { allowed: false, reason: "Contact email appears synthetic or unsuitable for outreach." };
  }

  if (input.requireVerifiedEmail && !input.contact.verified) {
    return { allowed: false, reason: "Contact email is not verified." };
  }

  if (typeof input.contact.confidence === "number" && input.contact.confidence < input.minConfidence) {
    return { allowed: false, reason: `Contact confidence ${input.contact.confidence} is below the configured minimum.` };
  }

  if (input.suppressedEmail || input.suppressedDomain) {
    return { allowed: false, reason: "Contact or company is suppressed from outreach." };
  }

  if (input.duplicateSequence) {
    return { allowed: false, reason: "An active or completed outreach sequence already exists for this contact and job." };
  }

  if (input.dryRun) {
    return { allowed: true, reason: "Dry-run safety gate passed; no email may be sent." };
  }

  return { allowed: true, reason: "Outreach safety gate passed." };
}
