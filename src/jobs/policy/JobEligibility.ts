import { Job } from "../domain/Job";

export type JobPriority = 1 | 2 | 3;
export type JobEligibilityDecision = "ELIGIBLE" | "REJECT";

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

function isRemote(job: Job): boolean {
  const location = normalize(job.location ?? "");

  return (
    location.includes("remote") ||
    location.includes("work from home") ||
    location.includes("wfh")
  );
}

function isBangalore(job: Job, policy: JobSearchPolicy): boolean {
  const location = job.location ?? "";

  return policy.priorityLocations.some((target) =>
    containsNormalized(location, target)
  );
}

function isIndia(job: Job): boolean {
  const location = normalize(job.location ?? "");

  return (
    location.includes("india") ||
    location.includes("bangalore") ||
    location.includes("bengaluru") ||
    location.includes("mumbai") ||
    location.includes("pune") ||
    location.includes("hyderabad") ||
    location.includes("delhi") ||
    location.includes("gurgaon") ||
    location.includes("gurugram") ||
    location.includes("noida") ||
    location.includes("chennai") ||
    location.includes("kolkata") ||
    location.includes("ahmedabad") ||
    location.includes("kochi") ||
    location.includes("indore")
  );
}

function isExcludedCompany(
  companyName: string,
  excludedCompanies: string[]
): boolean {
  return excludedCompanies.some((excluded) =>
    containsNormalized(companyName, excluded)
  );
}

export function evaluateJobEligibility(
  job: Job,
  policy: JobSearchPolicy
): JobEligibilityResult {
  if (isExcludedCompany(job.companyName, policy.excludedCompanies)) {
    return {
      decision: "REJECT",
      priority: null,
      reason: "Company is explicitly excluded from applications."
    };
  }

  if (isBangalore(job, policy)) {
    return {
      decision: "ELIGIBLE",
      priority: 1,
      reason: "Bangalore/Bengaluru is the highest-priority target location."
    };
  }

  if (isRemote(job)) {
    return {
      decision: "ELIGIBLE",
      priority: 3,
      reason: "Remote role is allowed by the job-search policy."
    };
  }

  if (isIndia(job)) {
    return {
      decision: "ELIGIBLE",
      priority: 2,
      reason: "Role is located in India."
    };
  }

  return {
    decision: "ELIGIBLE",
    priority: 3,
    reason: "Role is outside India but will be evaluated for candidate eligibility."
  };
}
