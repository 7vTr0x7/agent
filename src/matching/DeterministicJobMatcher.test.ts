import { DeterministicJobMatcher } from "./DeterministicJobMatcher";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { JobOpportunity } from "../jobs/domain/JobOpportunity";

const profile: CandidateProfile = {
  id: "candidate-1",
  yearsExperience: 3,
  skills: ["React", "Next.js", "TypeScript", "Redux Toolkit", "Node.js"],
  targetTitles: ["Frontend Engineer", "Frontend Developer"]
};

function job(description: string, title = "Frontend Developer"): JobOpportunity {
  return {
    id: "job-1",
    canonicalId: "canonical-1",
    canonicalUrl: "https://example.com/job-1",
    title,
    companyName: "Example",
    location: "Bengaluru",
    country: "India",
    workplaceType: "hybrid",
    employmentType: "full-time",
    description,
    postedAt: null,
    updatedAt: null,
    lastSeenAt: new Date(),
    closedAt: null,
    status: "ACTIVE",
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

describe("DeterministicJobMatcher", () => {
  const matcher = new DeterministicJobMatcher();

  it("scores matching skills and target titles", () => {
    const result = matcher.evaluate(
      job("React, TypeScript and Next.js are required. Node.js is a plus."),
      profile
    );

    expect(result.decision).toBe("APPLY");
    expect(result.matchScore).toBeGreaterThanOrEqual(70);
    expect(result.matchedSkills).toEqual(
      expect.arrayContaining(["React", "Next.js", "TypeScript", "Node.js"])
    );
  });

  it("rejects a role with a hard experience blocker", () => {
    const result = matcher.evaluate(
      job("Must have at least 5 years of experience with React."),
      profile
    );

    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBe(0);
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "HARD_BLOCKER" })
      ])
    );
  });

  it("can distinguish a low-overlap role", () => {
    const result = matcher.evaluate(
      job("Java, Spring Boot, Kafka and Kubernetes experience required.", "Backend Engineer"),
      profile
    );

    expect(result.decision).toBe("REJECT");
    expect(result.matchScore).toBeLessThan(40);
  });
});
