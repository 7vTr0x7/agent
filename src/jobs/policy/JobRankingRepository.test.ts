import { JobRankingRepository, PostgresJobRankingRepository } from "./JobRankingRepository";

const ranking = {
  jobOpportunityId: "job-1",
  candidateProfileId: "candidate-1",
  ranking: {
    score: 91,
    tier: 1 as const,
    locationScore: 100,
    matchScore: 88,
    freshnessBonus: 3,
    reason: "Location priority 1, match score 88, freshness bonus 3."
  }
};

describe("PostgresJobRankingRepository", () => {
  it("persists and upserts a ranking snapshot", async () => {
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const database = { query } as never;
    const repository: JobRankingRepository = new PostgresJobRankingRepository(database);

    await repository.save(ranking);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual([
      "job-1",
      "candidate-1",
      91,
      1,
      100,
      88,
      3,
      "Location priority 1, match score 88, freshness bonus 3."
    ]);
    expect(query.mock.calls[0][0]).toContain("ON CONFLICT (job_opportunity_id, candidate_profile_id)");
    expect(query.mock.calls[0][0]).toContain("rank_score = EXCLUDED.rank_score");
  });
});
