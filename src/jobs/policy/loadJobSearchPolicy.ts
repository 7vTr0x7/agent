import { JobSearchPolicy } from "./JobEligibility";

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function loadJobSearchPolicy(): JobSearchPolicy {
  const maxAgeDays = Number(process.env.JOB_MAX_AGE_DAYS ?? "0");

  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0) {
    throw new Error("JOB_MAX_AGE_DAYS must be a non-negative integer");
  }

  return {
    priorityLocations: parseList(
      process.env.JOB_PRIORITY_LOCATIONS ?? "Bangalore,Bengaluru"
    ),
    targetCountry: process.env.JOB_TARGET_COUNTRIES ?? "India",
    allowRemote:
      (process.env.JOB_ALLOW_REMOTE ?? "true").toLowerCase() === "true",
    excludedCompanies: parseList(
      process.env.JOB_EXCLUDED_COMPANIES ??
        "Octopus Technologies,Sketch Brahma Technologies"
    ),
    maxAgeDays
  };
}
