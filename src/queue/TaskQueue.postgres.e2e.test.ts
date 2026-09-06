import { Database } from "../database/Database";
import { MigrationRunner } from "../database/MigrationRunner";
import { TaskQueue } from "./TaskQueue";

const databaseUrl = process.env.DATABASE_URL;
const testIfDatabaseConfigured = databaseUrl ? it : it.skip;

describe("TaskQueue PostgreSQL integration", () => {
  testIfDatabaseConfigured("persists, claims, heartbeats, and completes a task", async () => {
    const database = new Database(databaseUrl!);
    const queue = new TaskQueue(database, 5_000);
    const dedupeKey = `postgres-e2e-${Date.now()}-${Math.random()}`;

    try {
      await new MigrationRunner(database).run();

      const firstId = await queue.enqueue({
        taskType: "POSTGRES_E2E",
        payload: { source: "integration-test" },
        priority: 10,
        dedupeKey
      });
      const duplicateId = await queue.enqueue({
        taskType: "POSTGRES_E2E",
        payload: { source: "duplicate" },
        priority: 1,
        dedupeKey
      });

      expect(duplicateId).toBe(firstId);

      const claimed = await queue.claim("postgres-e2e-worker");
      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(firstId);
      expect(claimed?.attempts).toBe(1);
      expect(await queue.heartbeat(firstId, "postgres-e2e-worker")).toBe(true);

      await queue.succeed(firstId, "postgres-e2e-worker");

      const result = await database.query<{ status: string; attempts: number }>(
        "SELECT status, attempts FROM tasks WHERE id = $1",
        [firstId]
      );
      expect(result.rows[0]).toEqual({ status: "SUCCEEDED", attempts: 1 });
    } finally {
      await database.query("DELETE FROM tasks WHERE dedupe_key = $1", [dedupeKey]);
      await database.close();
    }
  });
});
