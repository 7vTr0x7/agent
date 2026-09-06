import { ApplicationRepository } from "./ApplicationRepository";

interface QueryResult<T> {
  rows: T[];
}

describe("ApplicationRepository submission state", () => {
  function createDatabase(status: string) {
    const queries: string[] = [];
    const client = {
      query: async <T>(text: string): Promise<QueryResult<T>> => {
        queries.push(text);
        if (text.includes("SELECT status")) {
          return { rows: [{ status }] } as QueryResult<T>;
        }
        return { rows: [{}] } as QueryResult<T>;
      }
    };

    return {
      queries,
      database: {
        transaction: async <T>(callback: (transactionClient: typeof client) => Promise<T>) =>
          callback(client)
      }
    };
  }

  it("atomically reserves a READY application and records the transition", async () => {
    const { database, queries } = createDatabase("READY");
    const repository = new ApplicationRepository(database as never);

    await expect(repository.beginSubmission("application-1")).resolves.toBe(true);
    expect(queries.some((query) => query.includes("FOR UPDATE"))).toBe(true);
    expect(queries.some((query) => query.includes("SUBMISSION_IN_PROGRESS"))).toBe(true);
    expect(queries.some((query) => query.includes("APPLICATION_SUBMISSION_STARTED"))).toBe(true);
  });

  it("refuses to reserve an application already in progress", async () => {
    const { database, queries } = createDatabase("SUBMISSION_IN_PROGRESS");
    const repository = new ApplicationRepository(database as never);

    await expect(repository.beginSubmission("application-2")).resolves.toBe(false);
    expect(queries.filter((query) => query.includes("UPDATE applications"))).toHaveLength(0);
  });

  it("requires the in-progress state before marking an application SENT", async () => {
    const { database } = createDatabase("READY");
    const repository = new ApplicationRepository(database as never);

    await expect(
      repository.markSubmitted("application-3", null, "external-3")
    ).rejects.toThrow("Application cannot transition from status 'READY' to SENT.");
  });
});
