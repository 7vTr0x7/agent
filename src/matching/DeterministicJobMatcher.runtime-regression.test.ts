import { DeterministicJobMatcher } from "./DeterministicJobMatcher";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";

const profile: CandidateProfile = {
  id: "runtime-regression-candidate",
  yearsExperience: 3,
  skills: ["React", "Next.js", "TypeScript", "Redux Toolkit", "Node.js"],
  targetTitles: ["Frontend Engineer", "Frontend Developer", "React Developer", "Full Stack Developer"]
};

function job(overrides: Partial<JobOpportunity>): JobOpportunity {
  return {
    id: "runtime-regression-job",
    canonicalId: "runtime-regression-canonical",
    canonicalUrl: "https://example.com/job",
    title: "Software Engineer",
    companyName: "Example",
    location: "Bengaluru",
    country: "India",
    workplaceType: null,
    employmentType: "full-time",
    description: "React and TypeScript experience.",
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

describe("DeterministicJobMatcher runtime regressions", () => {
  const matcher = new DeterministicJobMatcher({ now: new Date("2026-09-24T12:00:00Z") });

  it("rejects foreign jobs when no remote eligibility is stated", () => {
    const result = matcher.evaluate(job({
      title: "Frontend Engineer",
      location: "Singapore",
      country: "Singapore",
      workplaceType: null,
      description: "Build React and TypeScript web applications."
    }), profile);

    expect(result.geography).toBe("FOREIGN_ONSITE");
    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
  });

  it("rejects foreign remote jobs when the posting does not establish worldwide eligibility", () => {
    const result = matcher.evaluate(job({
      title: "Frontend Engineer",
      location: "Singapore",
      country: "Singapore",
      workplaceType: "remote",
      description: "Remote from Singapore. React and TypeScript required."
    }), profile);

    expect(result.geography).toBe("REMOTE_RESTRICTED");
    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
  });

  it("allows explicit worldwide remote roles to remain reviewable rather than auto-apply", () => {
    const result = matcher.evaluate(job({
      title: "Frontend Engineer",
      location: "Worldwide",
      country: null,
      workplaceType: "remote",
      description: "Work remotely worldwide. React and TypeScript required."
    }), profile);

    expect(result.geography).toBe("REMOTE_WORLDWIDE");
    expect(result.decision).toBe("REVIEW");
  });

  it("rejects backend-specific Ruby on Rails roles despite frontend keywords in the description", () => {
    const result = matcher.evaluate(job({
      title: "Senior Ruby on Rails Developer",
      location: "Remote",
      country: null,
      workplaceType: "remote",
      description: "Maintain Ruby on Rails services. React and TypeScript dashboards consume the backend APIs."
    }), profile);

    expect(result.technicalOrientation).toBe("BACKEND_FOCUSED");
    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
  });
});
