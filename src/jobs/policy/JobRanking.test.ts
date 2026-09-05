import { evaluateJobEligibility } from "./JobEligibility";
import { rankJob } from "./JobRanking";

const policy = {
  priorityLocations: ["Bangalore", "Bengaluru"],
  targetCountry: "India",
  allowRemote: true,
  excludedCompanies: ["Octopus Technologies", "Sketch Brahma Technologies"],
  maxAgeDays: 0
};

const now = new Date("2026-09-05T00:00:00.000Z");

function eligibility(location: string, country: string | null = "India") {
  return evaluateJobEligibility(
    {
      companyName: "Example Company",
      location,
      country,
      workplaceType: location.toLowerCase().includes("remote") ? "remote" : "onsite"
    },
    policy
  );
}

describe("rankJob", () => {
  it("ranks Bangalore above other India locations", () => {
    const bangalore = rankJob({
      eligibility: eligibility("Bangalore, India"),
      deterministicMatchScore: 80,
      semanticMatchScore: 80,
      postedAt: now,
      now
    }, policy);

    const india = rankJob({
      eligibility: eligibility("Pune, India"),
      deterministicMatchScore: 80,
      semanticMatchScore: 80,
      postedAt: now,
      now
    }, policy);

    expect(bangalore.score).toBeGreaterThan(india.score);
  });

  it("keeps outside-India jobs rankable instead of rejecting them", () => {
    const result = rankJob({
      eligibility: eligibility("London, UK", "United Kingdom"),
      deterministicMatchScore: 80,
      semanticMatchScore: 80,
      postedAt: now,
      now
    }, policy);

    expect(result.tier).not.toBeNull();
    expect(result.score).toBeGreaterThan(0);
  });

  it("adds freshness without making age an eligibility gate", () => {
    const fresh = rankJob({
      eligibility: eligibility("Bangalore, India"),
      deterministicMatchScore: 70,
      semanticMatchScore: 70,
      postedAt: now,
      now
    }, policy);

    const old = rankJob({
      eligibility: eligibility("Bangalore, India"),
      deterministicMatchScore: 70,
      semanticMatchScore: 70,
      postedAt: new Date("2025-01-01T00:00:00.000Z"),
      now
    }, policy);

    expect(fresh.score).toBeGreaterThan(old.score);
  });

  it("does not rank an explicitly excluded company", () => {
    const excluded = evaluateJobEligibility(
      {
        companyName: "Octopus Technologies",
        location: "Bangalore, India",
        country: "India",
        workplaceType: "onsite"
      },
      policy
    );

    const result = rankJob({
      eligibility: excluded,
      deterministicMatchScore: 100,
      semanticMatchScore: 100,
      postedAt: now,
      now
    }, policy);

    expect(result.score).toBe(0);
    expect(result.tier).toBeNull();
  });

  it("uses the available match score when only one matcher has produced a result", () => {
    const result = rankJob({
      eligibility: eligibility("Bangalore, India"),
      deterministicMatchScore: 90,
      semanticMatchScore: null,
      postedAt: now,
      now
    }, policy);

    expect(result.score).toBe(95);
  });
});
