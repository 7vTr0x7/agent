export type ApplicationDecision = "ALLOW" | "BLOCK";

export const PERMANENTLY_EXCLUDED_COMPANIES = [
  "Octopus Technologies",
  "Sketch Brahma Technologies"
] as const;

export interface ApplicationPolicyInput {
  matchDecision: "APPLY" | "REJECT" | "REVIEW";
  opportunityStatus: "ACTIVE" | "STALE" | "CLOSED";
  hasRanking: boolean;
  hasExistingApplication: boolean;
  companyName: string;
  excludedCompanies: readonly string[];
}

export interface ApplicationPolicyResult {
  decision: ApplicationDecision;
  reason: string;
}

export function evaluateApplicationPolicy(
  input: ApplicationPolicyInput
): ApplicationPolicyResult {
  if (input.matchDecision !== "APPLY") {
    return { decision: "BLOCK", reason: "Job match decision is not APPLY." };
  }

  if (input.opportunityStatus !== "ACTIVE") {
    return { decision: "BLOCK", reason: "Job opportunity is not active." };
  }

  if (!input.hasRanking) {
    return { decision: "BLOCK", reason: "Job has no persisted ranking." };
  }

  if (input.hasExistingApplication) {
    return { decision: "BLOCK", reason: "An application already exists for this opportunity." };
  }

  const company = input.companyName.trim().toLowerCase();
  const configuredExcluded = input.excludedCompanies.some(
    (name) => name.trim().toLowerCase() === company
  );
  const permanentlyExcluded = PERMANENTLY_EXCLUDED_COMPANIES.some(
    (name) => name.toLowerCase() === company
  );

  if (configuredExcluded || permanentlyExcluded) {
    return { decision: "BLOCK", reason: "Company is excluded by application policy." };
  }

  return { decision: "ALLOW", reason: "Application passed all safety gates." };
}
