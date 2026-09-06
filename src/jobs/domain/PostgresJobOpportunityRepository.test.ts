import { PostgresJobOpportunityRepository } from "./PostgresJobOpportunityRepository";

const row = {
  id: "job-1", canonical_id: "canonical-1", canonical_url: "https://example.com/jobs/1", title: "Frontend Engineer", company_name: "Example Co", company_domain: null,
  location: "Bengaluru", country: "India", workplace_type: "hybrid" as const, employment_type: "FULL_TIME", description: "React and TypeScript role.",
  posted_at: new Date("2026-09-01T00:00:00Z"), source_updated_at: new Date("2026-09-02T00:00:00Z"), last_seen_at: new Date("2026-09-03T00:00:00Z"),
  closed_at: null, status: "ACTIVE" as const, created_at: new Date("2026-09-01T00:00:00Z"), updated_at: new Date("2026-09-02T00:00:00Z")
};

describe("PostgresJobOpportunityRepository", () => {
  it("finds an opportunity by id", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [row] });
    const repository = new PostgresJobOpportunityRepository({ query } as never);
    await expect(repository.findById("job-1")).resolves.toEqual({ id: "job-1", canonicalId: "canonical-1", canonicalUrl: "https://example.com/jobs/1", title: "Frontend Engineer", companyName: "Example Co", location: "Bengaluru", country: "India", workplaceType: "hybrid", employmentType: "FULL_TIME", description: "React and TypeScript role.", postedAt: row.posted_at, sourceUpdatedAt: row.updated_at, lastSeenAt: row.last_seen_at, closedAt: null, status: "ACTIVE", createdAt: row.created_at, updatedAt: row.updated_at });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FROM job_opportunities"), ["job-1"]);
  });

  it("finds an opportunity by canonical id", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [row] });
    const repository = new PostgresJobOpportunityRepository({ query } as never);
    await repository.findByCanonicalId("canonical-1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE canonical_id = $1"), ["canonical-1"]);
  });

  it("saves and upserts an opportunity", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [row] });
    const repository = new PostgresJobOpportunityRepository({ query } as never);
    await repository.save({ id: "job-1", canonicalId: "canonical-1", canonicalUrl: "https://example.com/jobs/1", title: "Frontend Engineer", companyName: "Example Co", location: "Bengaluru", country: "India", workplaceType: "hybrid", employmentType: "FULL_TIME", description: "React and TypeScript role.", postedAt: row.posted_at, sourceUpdatedAt: row.updated_at, lastSeenAt: row.last_seen_at, closedAt: null, status: "ACTIVE", createdAt: row.created_at, updatedAt: row.updated_at });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(["job-1", "canonical-1", "https://example.com/jobs/1", "Frontend Engineer", "Example Co", null, "Bengaluru", "India", "hybrid", "FULL_TIME", "React and TypeScript role.", row.posted_at, row.updated_at, row.last_seen_at, null, "ACTIVE"]);
    expect(query.mock.calls[0][0]).toContain("ON CONFLICT (id)");
    expect(query.mock.calls[0][0]).toContain("RETURNING id");
  });

  it("returns null when an opportunity is missing", async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresJobOpportunityRepository({ query } as never);
    await expect(repository.findById("missing")).resolves.toBeNull();
  });
});
