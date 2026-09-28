import { CandidateProfile } from "../../candidates/CandidateProfile";
import { JobSearchPolicy } from "./JobEligibility";

function parseList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function loadJobSearchPolicy(candidateProfile?: CandidateProfile): JobSearchPolicy {
  const maxAgeDays = Number(process.env.JOB_MAX_AGE_DAYS ?? "7");
  if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0) throw new Error("JOB_MAX_AGE_DAYS must be a non-negative integer");
  const minPersistenceRelevance = Number(process.env.MIN_PERSISTENCE_RELEVANCE ?? "45");
  if (!Number.isFinite(minPersistenceRelevance) || minPersistenceRelevance < 0 || minPersistenceRelevance > 100) throw new Error("MIN_PERSISTENCE_RELEVANCE must be between 0 and 100");
  return {
    priorityLocations: parseList(process.env.JOB_PRIORITY_LOCATIONS ?? "Bangalore,Bengaluru"),
    targetCountry: process.env.JOB_TARGET_COUNTRIES ?? "India",
    allowRemote: (process.env.JOB_ALLOW_REMOTE ?? "true").toLowerCase() === "true",
    excludedCompanies: parseList(process.env.JOB_EXCLUDED_COMPANIES ?? "Octopus Technologies,Sketch Brahma Technologies"),
    maxAgeDays,
    targetTitles: candidateProfile ? [...candidateProfile.targetTitles] : parseList(process.env.CANDIDATE_TARGET_TITLES),
    candidateSkills: candidateProfile ? [...candidateProfile.skills] : parseList(process.env.CANDIDATE_SKILLS),
    yearsExperience: candidateProfile?.yearsExperience ?? Number(process.env.CANDIDATE_YEARS_EXPERIENCE ?? "0"),
    minPersistenceRelevance
  };
}
