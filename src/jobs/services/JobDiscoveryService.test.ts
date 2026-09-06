import { JobDiscoveryService } from "./JobDiscoveryService";
import { Job } from "../domain/Job";

function job(overrides: Partial<Job> = {}): Job {
  return {
    source: "test", sourceJobId: "job-1", url: "https://example.com/jobs/frontend?utm_source=test",
    title: "Frontend Engineer", companyName: "Example", location: "Bangalore, India", country: "India",
    workplaceType: "onsite", employmentType: "Full-time", description: "React and TypeScript", postedAt: null, updatedAt: null, contentHash: "hash-1", ...overrides
  };
}

describe("JobDiscoveryService", () => {
  test("persists an opportunity and observation instead of only a legacy job", async () => {
    const queries: string[] = [];
    const database = { transaction: async (callback: (client: unknown) => Promise<unknown>) => callback({ query: async (sql: string) => { queries.push(sql); if (sql.includes("INSERT INTO job_opportunities")) return { rows: [{ id: "opportunity-1" }] }; return { rowCount: 1, rows: [{ id: "observation-1" }] }; } }) };
    const source = { name: "test", fetchJobs: async () => [job()] };
    const service = new JobDiscoveryService(database as never);
    const result = await service.discover(source);
    expect(result).toEqual({ source: "test", fetched: 1, inserted: 1, duplicates: 0, insertedOpportunityIds: ["opportunity-1"] });
    expect(queries.some((sql) => sql.includes("INSERT INTO job_opportunities"))).toBe(true);
    expect(queries.some((sql) => sql.includes("company_domain"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO job_observations"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO jobs"))).toBe(false);
  });

  test("persists a source-provided employer domain without deriving it from the job URL", async () => {
    const values: unknown[][] = [];
    const database = { transaction: async (callback: (client: unknown) => Promise<unknown>) => callback({ query: async (sql: string, params?: unknown[]) => { if (sql.includes("INSERT INTO job_opportunities")) { values.push(params ?? []); return { rows: [{ id: "opportunity-1" }] }; } return { rowCount: 1, rows: [{ id: "observation-1" }] }; } }) };
    const source = { name: "test", fetchJobs: async () => [job({ url: "https://boards.greenhouse.io/acme/jobs/1", companyDomain: "acme.com" })] };
    await new JobDiscoveryService(database as never).discover(source);
    expect(values[0]).toContain("acme.com");
    expect(values[0]).not.toContain("boards.greenhouse.io");
  });

  test("treats a duplicate observation as a duplicate without creating another opportunity", async () => {
    const queries: string[] = [];
    const database = { transaction: async (callback: (client: unknown) => Promise<unknown>) => callback({ query: async (sql: string) => { queries.push(sql); if (sql.includes("INSERT INTO job_opportunities")) return { rows: [{ id: "opportunity-1" }] }; return { rowCount: 0, rows: [] }; } }) };
    const source = { name: "test", fetchJobs: async () => [job()] };
    const result = await new JobDiscoveryService(database as never).discover(source);
    expect(result).toMatchObject({ inserted: 0, duplicates: 1 });
    expect(result.insertedOpportunityIds).toEqual([]);
    expect(queries).toHaveLength(2);
  });
});
