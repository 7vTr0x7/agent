import { ApplicationRepository } from "./ApplicationRepository";
import { ApplicationRateLimitPolicy } from "./ApplicationRateLimitPolicy";
import { ApplicationCompanyRateLimitPolicy } from "./ApplicationCompanyRateLimitPolicy";

interface QueryResult<T> {
  rows: T[];
}

describe("ApplicationRepository submission state", () => {
  function createDatabase(
    status: string,
    options: {
      dailyCount?: number;
      companyCount?: number;
      staleSubmissions?: Array<{
        id: string;
        candidate_profile_id: string;
        company_name: string;
        updated_at: Date;
      }>;
    } = {}
  ) {
    const queries: string[] = [];
    const client = {
      query: async <T>(text: string): Promise<QueryResult<T>> => {
        queries.push(text);

        if (
          text.includes("FROM applications a") &&
          text.includes("candidate_profile_id") &&
          text.includes("company_name") &&
          text.includes("FOR UPDATE OF a")
        ) {
          return {
            rows: [
              {
                status,
                candidate_profile_id: "candidate-1",
                company_name: "Example Co"
              }
            ]
          } as QueryResult<T>;
        }

        if (text.includes("SELECT pg_advisory_xact_lock")) {
          return { rows: [] } as QueryResult<T>;
        }

        if (
          text.includes("SELECT COUNT(*)::text AS count") &&
          text.includes("LOWER(TRIM(jo.company_name))")
        ) {
          return {
            rows: [{ count: String(options.companyCount ?? 0) }]
          } as QueryResult<T>;
        }

        if (text.includes("SELECT COUNT(*)::text AS count")) {
          return {
            rows: [{ count: String(options.dailyCount ?? 0) }]
          } as QueryResult<T>;
        }

        if (text.includes("SELECT status") && text.includes("FROM applications")) {
          return { rows: [{ status }] } as QueryResult<T>;
        }

        return { rows: [{}] } as QueryResult<T>;
      }
    };

    return {
      queries,
      database: {
        query: async <T>(text: string): Promise<QueryResult<T>> => {
          queries.push(text);
          if (
            text.includes("WHERE a.status = 'SUBMISSION_IN_PROGRESS'") &&
            text.includes("updated_at < NOW()")
          ) {
            return {
              rows: options.staleSubmissions ?? []
            } as QueryResult<T>;
          }

          return { rows: [] } as QueryResult<T>;
        },
        transaction: async <T>(callback: (transactionClient: typeof client) => Promise<T>) =>
          callback(client)
      }
    };
  }

  it("atomically reserves a READY application and records the transition", async () => {
    const { database, queries } = createDatabase("READY");
    const repository = new ApplicationRepository(database as never);

    await expect(repository.beginSubmission("application-1")).resolves.toBe(true);
    expect(queries.some((query) => query.includes("FOR UPDATE OF a"))).toBe(true);
    expect(queries.some((query) => query.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(queries.some((query) => query.includes("SUBMISSION_IN_PROGRESS"))).toBe(true);
    expect(queries.some((query) => query.includes("APPLICATION_SUBMISSION_STARTED"))).toBe(true);
  });

  it("refuses to reserve an application already in progress", async () => {
    const { database, queries } = createDatabase("SUBMISSION_IN_PROGRESS");
    const repository = new ApplicationRepository(database as never);

    await expect(repository.beginSubmission("application-2")).resolves.toBe(false);
    expect(queries.filter((query) => query.includes("UPDATE applications"))).toHaveLength(0);
  });

  it("blocks reservation when the daily submission limit is already reserved or used", async () => {
    const { database, queries } = createDatabase("READY", { dailyCount: 50 });
    const repository = new ApplicationRepository(database as never);

    await expect(repository.beginSubmission("application-daily-limit")).resolves.toBe(false);
    expect(queries.some((query) => query.includes("UPDATE applications"))).toBe(false);
  });

  it("blocks reservation when the company submission limit is already reserved or used", async () => {
    const { database, queries } = createDatabase("READY", { companyCount: 5 });
    const repository = new ApplicationRepository(database as never);

    await expect(repository.beginSubmission("application-company-limit")).resolves.toBe(false);
    expect(queries.some((query) => query.includes("UPDATE applications"))).toBe(false);
  });

  it("uses the configured daily submission limit at reservation time", async () => {
    const { database, queries } = createDatabase("READY", { dailyCount: 3 });
    const repository = new ApplicationRepository(
      database as never,
      [],
      new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 3 })
    );

    await expect(repository.beginSubmission("application-configured-daily-limit")).resolves.toBe(false);
    expect(queries.some((query) => query.includes("UPDATE applications"))).toBe(false);
  });

  it("uses the configured company submission limit at reservation time", async () => {
    const { database, queries } = createDatabase("READY", { companyCount: 2 });
    const repository = new ApplicationRepository(
      database as never,
      [],
      undefined,
      new ApplicationCompanyRateLimitPolicy({ maxSubmissionsPerCompanyPerDay: 2 })
    );

    await expect(repository.beginSubmission("application-configured-company-limit")).resolves.toBe(false);
    expect(queries.some((query) => query.includes("UPDATE applications"))).toBe(false);
  });

  it("requires the in-progress state before marking an application SENT", async () => {
    const { database } = createDatabase("READY");
    const repository = new ApplicationRepository(database as never);

    await expect(
      repository.markSubmitted("application-3", null, "external-3")
    ).rejects.toThrow("Application cannot transition from status 'READY' to SENT.");
  });

  it("lists stale submissions without changing their state", async () => {
    const startedAt = new Date("2026-09-06T10:00:00.000Z");
    const { database, queries } = createDatabase("READY", {
      staleSubmissions: [
        {
          id: "application-stale-1",
          candidate_profile_id: "candidate-1",
          company_name: "Example Co",
          updated_at: startedAt
        }
      ]
    });
    const repository = new ApplicationRepository(database as never);

    await expect(repository.listStaleSubmissions(30)).resolves.toEqual([
      {
        applicationId: "application-stale-1",
        candidateProfileId: "candidate-1",
        companyName: "Example Co",
        startedAt
      }
    ]);
    expect(queries.some((query) => query.includes("WHERE a.status = 'SUBMISSION_IN_PROGRESS'"))).toBe(true);
    expect(queries.some((query) => query.includes("updated_at < NOW()"))).toBe(true);
    expect(queries.some((query) => query.includes("UPDATE applications"))).toBe(false);
  });

  it("rejects a non-positive stale-submission threshold", async () => {
    const { database } = createDatabase("READY");
    const repository = new ApplicationRepository(database as never);

    await expect(repository.listStaleSubmissions(0)).rejects.toThrow(
      "olderThanMinutes must be a positive finite number."
    );
  });

  it("recovers only a stale in-progress application and records a distinct recovery event", async () => {
    const queries: string[] = [];
    const client = {
      query: async <T>(text: string): Promise<QueryResult<T>> => {
        queries.push(text);
        if (text.includes("SELECT status, updated_at")) {
          return {
            rows: [{ status: "SUBMISSION_IN_PROGRESS", updated_at: new Date("2026-09-06T10:00:00.000Z") }]
          } as QueryResult<T>;
        }
        if (text.includes("SELECT updated_at < NOW()")) {
          return { rows: [{ stale: true }] } as QueryResult<T>;
        }
        return { rows: [] } as QueryResult<T>;
      }
    };
    const database = {
      query: async <T>() => ({ rows: [] }) as QueryResult<T>,
      transaction: async <T>(callback: (transactionClient: typeof client) => Promise<T>) => callback(client)
    };
    const repository = new ApplicationRepository(database as never);
    const evidence = {
      confirmationUrl: "https://jobs.example.com/confirmation/abc",
      externalApplicationId: "APP-123",
      verificationSource: "INDEPENDENT_CONFIRMATION" as const
    };

    await expect(repository.recoverVerifiedSubmission("application-stale-1", 30, evidence)).resolves.toEqual({
      applicationId: "application-stale-1",
      confirmationUrl: evidence.confirmationUrl,
      externalApplicationId: evidence.externalApplicationId
    });
    expect(queries.some((query) => query.includes("FOR UPDATE"))).toBe(true);
    expect(queries.some((query) => query.includes("APPLICATION_SUBMISSION_RECOVERED"))).toBe(true);
    expect(queries.some((query) => query.includes("SET status = 'SENT'"))).toBe(true);
  });

  it("does not recover an ambiguous non-stale submission", async () => {
    const client = {
      query: async <T>(text: string): Promise<QueryResult<T>> => {
        if (text.includes("SELECT status, updated_at")) {
          return {
            rows: [{ status: "SUBMISSION_IN_PROGRESS", updated_at: new Date() }]
          } as QueryResult<T>;
        }
        if (text.includes("SELECT updated_at < NOW()")) {
          return { rows: [{ stale: false }] } as QueryResult<T>;
        }
        return { rows: [] } as QueryResult<T>;
      }
    };
    const database = {
      query: async <T>() => ({ rows: [] }) as QueryResult<T>,
      transaction: async <T>(callback: (transactionClient: typeof client) => Promise<T>) => callback(client)
    };
    const repository = new ApplicationRepository(database as never);

    await expect(
      repository.recoverVerifiedSubmission("application-recent", 30, {
        confirmationUrl: "https://jobs.example.com/confirmation/abc",
        externalApplicationId: "APP-123",
        verificationSource: "INDEPENDENT_CONFIRMATION"
      })
    ).resolves.toBeNull();
  });
});
