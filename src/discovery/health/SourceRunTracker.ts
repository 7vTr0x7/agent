import { PoolClient } from "pg";
import { Database } from "../../database/Database";
import { SourceDescriptor } from "../policy/SourcePolicy";

export type SourceRunStatus = "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";
export type SourceErrorClassification =
  | "TRANSIENT"
  | "PERMANENT"
  | "INVALID_DATA"
  | "RATE_LIMIT"
  | "UNKNOWN";

export interface SourceRunStats {
  fetched: number;
  inserted: number;
  duplicates: number;
}

export interface SourceErrorInput {
  classification: SourceErrorClassification;
  message: string;
  attempt?: number;
  statusCode?: number;
  retryAfterSeconds?: number;
  nextRetryAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export class SourceRunTracker {
  constructor(private readonly database: Database) {}

  async start(descriptor: SourceDescriptor): Promise<string> {
    return this.database.transaction(async (client) => {
      await this.upsertSource(client, descriptor);

      const result = await client.query<{ id: string }>(
        `
          INSERT INTO source_runs (source_id, status)
          VALUES ($1, 'RUNNING')
          RETURNING id
        `,
        [descriptor.id]
      );

      const run = result.rows[0];
      if (!run) throw new Error("Failed to create source run");

      await client.query(
        `UPDATE sources SET last_run_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [descriptor.id]
      );

      return run.id;
    });
  }

  async complete(
    runId: string,
    sourceId: string,
    status: SourceRunStatus,
    stats: SourceRunStats,
    errorSummary?: string
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `
          UPDATE source_runs
          SET status = $2,
              finished_at = NOW(),
              fetched_count = $3,
              inserted_count = $4,
              duplicate_count = $5,
              error_summary = $6
          WHERE id = $1
        `,
        [runId, status, stats.fetched, stats.inserted, stats.duplicates, errorSummary ?? null]
      );

      if (status === "SUCCEEDED") {
        await client.query(
          `
            UPDATE sources
            SET consecutive_failures = 0,
                last_success_at = NOW(),
                disabled_until = NULL,
                updated_at = NOW()
            WHERE id = $1
          `,
          [sourceId]
        );
      }
    });
  }

  async recordError(
    runId: string,
    sourceId: string,
    error: SourceErrorInput
  ): Promise<void> {
    await this.database.transaction(async (client) => {
      await client.query(
        `
          INSERT INTO source_errors (
            source_run_id, source_id, classification, attempt, message,
            status_code, retry_after_seconds, next_retry_at, metadata
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
        `,
        [
          runId,
          sourceId,
          error.classification,
          error.attempt ?? 1,
          error.message,
          error.statusCode ?? null,
          error.retryAfterSeconds ?? null,
          error.nextRetryAt ?? null,
          JSON.stringify(error.metadata ?? {})
        ]
      );

      await client.query(
        `
          UPDATE source_runs
          SET error_count = error_count + 1
          WHERE id = $1
        `,
        [runId]
      );

      await client.query(
        `
          UPDATE sources
          SET consecutive_failures = consecutive_failures + 1,
              updated_at = NOW()
          WHERE id = $1
        `,
        [sourceId]
      );
    });
  }

  async markReviewRequired(sourceId: string, threshold: number): Promise<void> {
    await this.database.query(
      `
        UPDATE sources
        SET status = CASE
          WHEN consecutive_failures >= $2 THEN 'REVIEW_REQUIRED'
          ELSE status
        END,
        updated_at = NOW()
        WHERE id = $1
      `,
      [sourceId, threshold]
    );
  }

  private async upsertSource(
    client: PoolClient,
    descriptor: SourceDescriptor
  ): Promise<void> {
    await client.query(
      `
        INSERT INTO sources (id, name, source_type, status)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          source_type = EXCLUDED.source_type,
          updated_at = NOW()
      `,
      [descriptor.id, descriptor.name, descriptor.type, descriptor.policy.status]
    );
  }
}
