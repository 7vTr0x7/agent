import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { Database } from "../database/Database";

export type TaskStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "DEAD_LETTER";

export interface Task<TPayload = Record<string, unknown>> {
  id: string;
  taskType: string;
  payload: TPayload;
  status: TaskStatus;
  priority: number;
  availableAt: Date;
  lockedAt: Date | null;
  leaseExpiresAt: Date | null;
  lockedBy: string | null;
  attempts: number;
  maxAttempts: number;
  dedupeKey: string | null;
}

export interface EnqueueTaskInput<TPayload> {
  taskType: string;
  payload: TPayload;
  priority?: number;
  availableAt?: Date;
  maxAttempts?: number;
  dedupeKey?: string;
}

export interface ClaimedTask<TPayload = Record<string, unknown>> extends Task<TPayload> {
  workerId: string;
}

export interface RecoverStaleTasksResult {
  recovered: number;
}

export class TaskQueue {
  constructor(
    private readonly database: Database,
    private readonly leaseDurationMs = 60_000
  ) {}

  async enqueue<TPayload>(input: EnqueueTaskInput<TPayload>): Promise<string> {
    const id = randomUUID();
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO tasks (id, task_type, payload, priority, available_at, max_attempts, dedupe_key, lease_expires_at)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,NULL)
       ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('PENDING','RUNNING')
       DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [id, input.taskType, JSON.stringify(input.payload), input.priority ?? 0, input.availableAt ?? new Date(), input.maxAttempts ?? 3, input.dedupeKey ?? null]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Failed to enqueue task");
    return row.id;
  }

  async claim<TPayload = Record<string, unknown>>(workerId: string, taskTypes?: string[]): Promise<ClaimedTask<TPayload> | null> {
    return this.database.transaction(async (client) => {
      const result = await client.query<TaskRow<TPayload>>(
        `SELECT * FROM tasks
         WHERE status = 'PENDING' AND available_at <= NOW()
           AND ($1::text[] IS NULL OR task_type = ANY($1))
         ORDER BY priority DESC, available_at ASC, created_at ASC
         FOR UPDATE SKIP LOCKED LIMIT 1`,
        [taskTypes?.length ? taskTypes : null]
      );
      const row = result.rows[0];
      if (!row) return null;
      const attempt = row.attempts + 1;
      const leaseExpiresAt = new Date(Date.now() + this.leaseDurationMs);
      await client.query(
        `UPDATE tasks SET status='RUNNING', locked_at=NOW(), lease_expires_at=$2, locked_by=$3, attempts=$4, updated_at=NOW() WHERE id=$1`,
        [row.id, leaseExpiresAt, workerId, attempt]
      );
      await client.query(
        `INSERT INTO task_attempts (task_id, attempt, worker_id, status) VALUES ($1,$2,$3,'RUNNING')`,
        [row.id, attempt, workerId]
      );
      return { ...mapTask(row), status: "RUNNING", lockedAt: new Date(), leaseExpiresAt, lockedBy: workerId, attempts: attempt, workerId };
    });
  }

  async heartbeat(taskId: string, workerId: string): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE tasks SET lease_expires_at=$3, updated_at=NOW()
       WHERE id=$1 AND status='RUNNING' AND locked_by=$2 AND lease_expires_at > NOW()`,
      [taskId, workerId, new Date(Date.now() + this.leaseDurationMs)]
    );
    return result.rowCount === 1;
  }

  async recoverStaleTasks(): Promise<RecoverStaleTasksResult> {
    return this.database.transaction(async (client) => {
      const result = await client.query<{ id: string; status: TaskStatus }>(
        `UPDATE tasks
         SET status = CASE WHEN attempts >= max_attempts THEN 'DEAD_LETTER' ELSE 'PENDING' END,
             available_at = NOW(), locked_at = NULL, lease_expires_at = NULL, locked_by = NULL,
             last_error = 'Worker lease expired; task recovered.', updated_at = NOW()
         WHERE status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at <= NOW()
         RETURNING id, status`
      );
      for (const task of result.rows) {
        await client.query(
          `UPDATE task_attempts SET status='FAILED', finished_at=NOW(), error='Worker lease expired; task recovered.' WHERE task_id=$1 AND status='RUNNING'`,
          [task.id]
        );
      }
      for (const task of result.rows.filter((row) => row.status === "DEAD_LETTER")) {
        await client.query(
          `INSERT INTO dead_letter_tasks (task_id, task_type, payload, attempts, reason)
           SELECT id, task_type, payload, attempts, 'Worker lease expired after maximum attempts.' FROM tasks WHERE id=$1
           ON CONFLICT (task_id) DO NOTHING`,
          [task.id]
        );
      }
      return { recovered: result.rowCount ?? 0 };
    });
  }

  async succeed(taskId: string, workerId: string): Promise<void> {
    await this.database.transaction(async (client) => {
      const task = await lockOwnedTask(client, taskId, workerId);
      if (!task) throw new Error("Task is not owned by this worker");
      await client.query(`UPDATE tasks SET status='SUCCEEDED', locked_at=NULL, lease_expires_at=NULL, locked_by=NULL, completed_at=NOW(), updated_at=NOW() WHERE id=$1`, [taskId]);
      await client.query(`UPDATE task_attempts SET status='SUCCEEDED', finished_at=NOW() WHERE task_id=$1 AND attempt=$2 AND worker_id=$3`, [taskId, task.attempts, workerId]);
    });
  }

  async fail(taskId: string, workerId: string, error: string, retryAt?: Date): Promise<TaskStatus> {
    return this.database.transaction(async (client) => {
      const task = await lockOwnedTask(client, taskId, workerId);
      if (!task) throw new Error("Task is not owned by this worker");
      const deadLetter = task.attempts >= task.max_attempts;
      const status: TaskStatus = deadLetter ? "DEAD_LETTER" : "PENDING";
      await client.query(`UPDATE tasks SET status=$2, available_at=$3, locked_at=NULL, lease_expires_at=NULL, locked_by=NULL, last_error=$4, updated_at=NOW() WHERE id=$1`, [taskId, status, deadLetter ? new Date() : (retryAt ?? new Date()), error]);
      await client.query(`UPDATE task_attempts SET status='FAILED', finished_at=NOW(), error=$4 WHERE task_id=$1 AND attempt=$2 AND worker_id=$3`, [taskId, task.attempts, workerId, error]);
      if (deadLetter) {
        await client.query(`INSERT INTO dead_letter_tasks (task_id, task_type, payload, attempts, reason) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (task_id) DO NOTHING`, [taskId, task.task_type, JSON.stringify(task.payload), task.attempts, error]);
      }
      return status;
    });
  }
}

interface TaskRow<TPayload> {
  id: string;
  task_type: string;
  payload: TPayload;
  status: TaskStatus;
  priority: number;
  available_at: Date;
  locked_at: Date | null;
  lease_expires_at: Date | null;
  locked_by: string | null;
  attempts: number;
  max_attempts: number;
  dedupe_key: string | null;
}

function mapTask<TPayload>(row: TaskRow<TPayload>): Task<TPayload> {
  return { id: row.id, taskType: row.task_type, payload: row.payload, status: row.status, priority: row.priority, availableAt: row.available_at, lockedAt: row.locked_at, leaseExpiresAt: row.lease_expires_at, lockedBy: row.locked_by, attempts: row.attempts, maxAttempts: row.max_attempts, dedupeKey: row.dedupe_key };
}

async function lockOwnedTask(client: PoolClient, taskId: string, workerId: string): Promise<TaskRow<Record<string, unknown>> | null> {
  const result = await client.query<TaskRow<Record<string, unknown>>>(`SELECT * FROM tasks WHERE id=$1 AND status='RUNNING' AND locked_by=$2 AND lease_expires_at > NOW() FOR UPDATE`, [taskId, workerId]);
  return result.rows[0] ?? null;
}
