import { assessJobRisk } from "./JobRiskPolicy";

export type JobPriority = 1 | 2 | 3;
export type JobEligibilityDecision = "ELIGIBLE" | "REJECT";

export interface JobEligibilityInput {
  companyName: string;
  title?: string;
  description?: string;
  location: string | null;
  country: string | null;
  workplaceType: "onsite" | "remote" | "hybrid" | null;
}

export interface JobEligibilityResult {
  decision: JobEligibilityDecision;
  priority: JobPriority | null;
  reason: string;
}

export interface JobSearchPolicy {
  priorityLocations: string[];
  targetCountry: string;
  allowRemote: boolean;
  excludedCompanies: string[];
  maxAgeDays: number;
}

function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function containsNormalized(value: string, target: string): boolean {
  return normalize(value).includes(normalize(target));
}

function isExcludedCompany(companyName: string, excludedCompanies: string[]): boolean {
  return excludedCompanies.some((excluded) => containsNormalized(companyName, excluded));
}

function isRemote(job: JobEligibilityInput): boolean {
  if (job.workplaceType === "remote") return true;
  const location = normalize(job.location ?? "");
  return location.includes("remote") || location.includes("work from home") || location.includes("wfh");
}

function isBangalore(job: JobEligibilityInput, policy: JobSearchPolicy): boolean {
  const location = job.location ?? "";
  return policy.priorityLocations.some((target) => containsNormalized(location, target));
}

function isTargetCountry(job: JobEligibilityInput, policy: JobSearchPolicy): boolean {
  if (job.country) return normalize(job.country) === normalize(policy.targetCountry);
  return containsNormalized(job.location ?? "", policy.targetCountry);
}

export function evaluateJobEligibility(
  job: JobEligibilityInput,
  policy: JobSearchPolicy
): JobEligibilityResult {
  if (isExcludedCompany(job.companyName, policy.excludedCompanies)) {
    return {
      decision: "REJECT",
      priority: null,
      reason: "Company is explicitly excluded from applications."
    };
  }

  const risk = assessJobRisk({
    title: job.title ?? "",
    companyName: job.companyName,
    description: job.description ?? ""
  });

  if (risk.level === "HIGH") {
    return {
      decision: "REJECT",
      priority: null,
      reason: `Job was rejected by the safety-risk policy: ${risk.reasons.join(" ")}`
    };
  }

  if (isBangalore(job, policy)) {
    return {
      decision: "ELIGIBLE",
      priority: 1,
      reason: risk.level === "MEDIUM"
        ? "Bangalore/Bengaluru is the highest-priority target location; the listing also carries a medium-risk warning."
        : "Bangalore/Bengaluru is the highest-priority target location."
    };
  }

  if (isRemote(job)) {
    if (!policy.allowRemote) {
      return {
        decision: "REJECT",
        priority: null,
        reason: "Remote work is disabled by the job-search policy."
      };
    }

    return {
      decision: "ELIGIBLE",
      priority: 3,
      reason: risk.level === "MEDIUM"
        ? "Remote role is allowed by the job-search policy; the listing also carries a medium-risk warning."
        : "Remote role is allowed by the job-search policy."
    };
  }

  if (isTargetCountry(job, policy)) {
    return {
      decision: "ELIGIBLE",
      priority: 2,
      reason: risk.level === "MEDIUM"
        ? "Role is located in the target country; the listing also carries a medium-risk warning."
        : "Role is located in the target country."
    };
  }

  return {
    decision: "ELIGIBLE",
    priority: 3,
    reason: risk.level === "MEDIUM"
      ? "Role is outside the target country but will be evaluated for candidate eligibility; the listing also carries a medium-risk warning."
      : "Role is outside the target country but will be evaluated for candidate eligibility."
  };
}
