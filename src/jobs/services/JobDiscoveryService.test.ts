import { JobDiscoveryService } from "./JobDiscoveryService";
import { Job } from "../domain/Job";
import { JobSearchPolicy } from "../policy/JobEligibility";

const policy: JobSearchPolicy = {
  priorityLocations: ["Bangalore", "Bengaluru"],
  targetCountry: "India",
  allowRemote: true,
  excludedCompanies: [],
  maxAgeDays: 7,
  targetTitles: ["Frontend Engineer", "Frontend Developer", "Full Stack Engineer"],
  candidateSkills: ["React.js", "Next.js", "JavaScript", "TypeScript", "Redux Toolkit", "Node.js", "Express.js", "MongoDB"],
  yearsExperience: 3,
  minPersistenceRelevance: 45
};

function job(overrides: Partial<Job> = {}): Job {
  return {
    source: "test", sourceJobId: "job-1", url: "https://example.com/jobs/frontend?utm_source=test",
    title: "Frontend Engineer", companyName: "Example", location: "Bangalore, India", country: "India",
    workplaceType: "onsite", employmentType: "Full-time", description: "React and TypeScript", postedAt: null, updatedAt: null, contentHash: "hash-1", ...overrides
  };
}

function databaseForNewOpportunity(queries: string[], values: unknown[][] = []) {
  return {
    transaction: async (callback: (client: unknown) => Promise<unknown>) => callback({
      query: async (sql: string, params?: unknown[]) => {
        queries.push(sql);
        if (sql.includes("INSERT INTO job_opportunities")) {
          values.push(params ?? []);
          return { rows: [{ id: "opportunity-1" }] };
        }
        if (sql.includes("INSERT INTO job_observations")) return { rowCount: 1, rows: [{ id: "observation-1" }] };
        return { rowCount: 0, rows: [] };
      }
    })
  };
}

describe("JobDiscoveryService", () => {
  test("persists an eligible opportunity and observation", async () => {
    const queries: string[] = [];
    const database = databaseForNewOpportunity(queries);
    const source = { name: "test", fetchJobs: async () => [job()] };
    const result = await new JobDiscoveryService(database as never, policy).discover(source);
    expect(result).toMatchObject({ source: "test", fetched: 1, normalized: 1, hardRejected: 0, eligible: 1, inserted: 1, duplicates: 0, insertedOpportunityIds: ["opportunity-1"] });
    expect(queries.some((sql) => sql.includes("INSERT INTO job_opportunities"))).toBe(true);
    expect(queries.some((sql) => sql.includes("company_domain"))).toBe(true);
    expect(queries.some((sql) => sql.includes("COALESCE($12,NOW())"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO job_observations"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO jobs"))).toBe(false);
  });

  test("does not persist an obviously irrelevant opportunity", async () => {
    const queries: string[] = [];
    const database = databaseForNewOpportunity(queries);
    const source = { name: "test", fetchJobs: async () => [job({ title: "Payroll Specialist", description: "Payroll processing and accounting." })] };
    const result = await new JobDiscoveryService(database as never, policy).discover(source);
    expect(result.hardRejected).toBe(1);
    expect(result.inserted).toBe(0);
    expect(result.duplicates).toBe(0);
    expect(result.rejectedSamples[0]).toMatchObject({ title: "Payroll Specialist", classification: "IRRELEVANT" });
    expect(queries.some((sql) => sql.includes("INSERT INTO job_opportunities"))).toBe(false);
    expect(queries.some((sql) => sql.includes("INSERT INTO job_observations"))).toBe(false);
  });

  test("persists a source-provided employer domain without deriving it from the job URL", async () => {
    const values: unknown[][] = [];
    const queries: string[] = [];
    const database = databaseForNewOpportunity(queries, values);
    const source = { name: "test", fetchJobs: async () => [job({ url: "https://boards.greenhouse.io/acme/jobs/1", companyDomain: "acme.com" })] };
    await new JobDiscoveryService(database as never, policy).discover(source);
    expect(values[0]).toContain("acme.com");
    expect(values[0]).not.toContain("boards.greenhouse.io");
  });

  test("treats a duplicate observation as a duplicate without creating another opportunity", async () => {
    const queries: string[] = [];
    const database = {
      transaction: async (callback: (client: unknown) => Promise<unknown>) => callback({
        query: async (sql: string) => {
          queries.push(sql);
          if (sql.includes("SELECT id\n          FROM job_opportunities")) return { rows: [{ id: "opportunity-1" }] };
          return { rowCount: 1, rows: [{ id: "observation-1" }] };
        }
      })
    };
    const source = { name: "second-source", fetchJobs: async () => [job({ source: "second-source", sourceJobId: "other-job", url: "https://other-platform.example/jobs/99", contentHash: "other-hash" })] };
    const result = await new JobDiscoveryService(database as never, policy).discover(source);
    expect(result).toMatchObject({ inserted: 0, duplicates: 1 });
    expect(result.insertedOpportunityIds).toEqual([]);
    expect(queries.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO job_observations"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO job_opportunities"))).toBe(false);
  });
});
