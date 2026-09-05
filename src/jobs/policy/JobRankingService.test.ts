import { JobOpportunity } from "../domain/JobOpportunity";
import { JobRankingRepository } from "./JobRankingRepository";
import { JobRankingService } from "./JobRankingService";

const policy = {
  priorityLocations: ["Bangalore", "Bengaluru"],
  targetCountry: "India",
  allowRemote: true,
  excludedCompanies: ["Octopus Technologies", "Sketch Brahma Technologies"],
  maxAgeDays: 0
};

const job: JobOpportunity = {
  id: "job-1",
  canonicalId: "canonical-1",
  canonicalUrl: "https://example.com/job-1",
  title: "Frontend Engineer",
  companyName: "Example Company",
  location: "Bengaluru, India",
  country: "India",
  workplaceType: "hybrid",
  employmentType: "full-time",
  description: "React and TypeScript application development.",
  postedAt: new Date("2026-09-04T00:00:00.000Z"),
  sourceUpdatedAt: new Date("2026-09-04T00:00:00.000Z"),
  lastSeenAt: new Date("2026-09-05T00:00:00.000Z"),
  closedAt: null,
  status: "ACTIVE",
  createdAt: new Date("2026-09-04T00:00:00.000Z"),
  updatedAt: new Date("2026-09-05T00:00:00.000Z")
};

describe("JobRankingService", () => {
  it("evaluates, ranks, and persists an eligible job", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const repository: JobRankingRepository = { save };
    const service = new JobRankingService(policy, repository);

    const result = await service.rankAndPersist({
      job,
      candidateProfileId: "candidate-1",
      deterministicMatchScore: 90,
      semanticMatchScore: 80,
      now: new Date("2026-09-05T00:00:00.000Z")
    });

    expect(result.eligibility.decision).toBe("ELIGIBLE");
    expect(result.eligibility.priority).toBe(1);
    expect(result.ranking.score).toBeGreaterThan(0);
    expect(result.persisted).toBe(true);
    expect(save).toHaveBeenCalledWith({
      jobOpportunityId: "job-1",
      candidateProfileId: "candidate-1",
      ranking: result.ranking
    });
  });

  it("does not persist an explicitly excluded company", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const repository: JobRankingRepository = { save };
    const service = new JobRankingService(policy, repository);

    const result = await service.rankAndPersist({
      job: {
        ...job,
        companyName: "Octopus Technologies"
      },
      candidateProfileId: "candidate-1",
      deterministicMatchScore: 100,
      semanticMatchScore: 100,
      now: new Date("2026-09-05T00:00:00.000Z")
    });

    expect(result.eligibility.decision).toBe("REJECT");
    expect(result.ranking.tier).toBeNull();
    expect(result.persisted).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
});
