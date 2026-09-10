import { JobAgentApiServer } from "./JobAgentApiServer";
import { Database } from "../database/Database";

describe("JobAgentApiServer", () => {
  it("serves health and summary endpoints without exposing secrets", async () => {
    const database = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("SELECT 1")) return { rows: [{ "?column?": 1 }] };
        return { rows: [{ jobs: "12", matches: "8", applications: "3", recruiters: "2", outreachSent: "1", pendingTasks: "4" }] };
      })
    } as unknown as Database;
    const server = new JobAgentApiServer(database, { host: "127.0.0.1", port: 39017 });

    await server.start();
    try {
      const health = await fetch("http://127.0.0.1:39017/healthz");
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", database: "ok" });

      const summary = await fetch("http://127.0.0.1:39017/api/summary");
      expect(summary.status).toBe(200);
      expect(await summary.json()).toEqual({ jobs: "12", matches: "8", applications: "3", recruiters: "2", outreachSent: "1", pendingTasks: "4" });
    } finally {
      await server.stop();
    }
  });
});
