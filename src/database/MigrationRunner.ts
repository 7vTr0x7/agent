import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Database } from "./Database";
import { AppError } from "../shared/errors/AppError";

interface Migration {
  name: string;
  sql: string;
}

export class MigrationRunner {
  constructor(private readonly database: Database) {}

  async run(): Promise<void> {
    await this.database.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const migrations = await this.loadMigrations();

    for (const migration of migrations) {
      const result = await this.database.query<{ name: string }>(
        "SELECT name FROM schema_migrations WHERE name = $1",
        [migration.name]
      );

      if (result.rowCount && result.rowCount > 0) {
        continue;
      }

      await this.database.transaction(async (client) => {
        try {
          await client.query(migration.sql);
          await client.query(
            "INSERT INTO schema_migrations (name) VALUES ($1)",
            [migration.name]
          );
        } catch (error) {
          throw new AppError(`Migration failed: ${migration.name}`, {
            code: "MIGRATION_FAILED",
            statusCode: 500,
            cause: error
          });
        }
      });
    }
  }

  private async loadMigrations(): Promise<Migration[]> {
    const migrationsDir = join(
      process.cwd(),
      "src",
      "database",
      "migrations"
    );

    const files = (await readdir(migrationsDir))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();

    return Promise.all(
      files.map(async (name) => ({
        name,
        sql: await readFile(join(migrationsDir, name), "utf8")
      }))
    );
  }
}
