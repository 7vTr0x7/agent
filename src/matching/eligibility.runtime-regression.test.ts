import { DeterministicJobMatcher } from "./DeterministicJobMatcher";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";

const profile: CandidateProfile = {
  id: "eligibility-regression-candidate",
  yearsExperience: 3,
  skills: ["React", "Next.js", "TypeScript"],
  targetTitles: ["Frontend Engineer", "React Developer"],
  location: "India",
  workAuthorization: undefined
};

function job(overrides: Partial<JobOpportunity>): JobOpportunity {
  return {
    id: "eligibility-regression-job",
    canonicalId: "eligibility-regression-canonical",
    canonicalUrl: "https://example.com/job",
    title: "Frontend Engineer",
    companyName: "Example",
    location: "Bengaluru",
    country: "India",
    workplaceType: "onsite",
    employmentType: "full-time",
    description: "React, Next.js and TypeScript required.",
    postedAt: new Date("2026-09-24T00:00:00Z"),
    sourceUpdatedAt: null,
    lastSeenAt: new Date("2026-09-24T00:00:00Z"),
    closedAt: null,
    status: "ACTIVE",
    createdAt: new Date("2026-09-24T00:00:00Z"),
    updatedAt: new Date("2026-09-24T00:00:00Z"),
    ...overrides
  };
}

describe("matcher eligibility runtime regressions", () => {
  const matcher = new DeterministicJobMatcher({ now: new Date("2026-09-24T12:00:00Z") });

  it("rejects a structured foreign onsite country even when the city/country is not in the legacy country regex", () => {
    const result = matcher.evaluate(job({
      location: "Lisbon",
      country: "Portugal",
      workplaceType: "onsite",
      description: "Build React and TypeScript applications."
    }), profile);

    expect(result.geography).toBe("FOREIGN_ONSITE");
    expect(result.decision).toBe("REJECT");
  });

  it("does not treat a mandatory US citizenship requirement as an automatic match when candidate authorization is unknown", () => {
    const result = matcher.evaluate(job({
      location: "Worldwide",
      country: null,
      workplaceType: "remote",
      description: "Work remotely worldwide. US citizenship is required. React and TypeScript required."
    }), profile);

    expect(result.decision).toBe("REVIEW");
    expect(result.evidence.some((entry) => entry.detail.includes("US citizenship"))).toBe(true);
  });
});
