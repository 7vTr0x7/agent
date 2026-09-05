import { randomUUID } from "node:crypto";
import { ClaimedTask, TaskQueue } from "./TaskQueue";

export type TaskHandler<TPayload = Record<string, unknown>> = (
  task: ClaimedTask<TPayload>
) => Promise<void>;

export interface WorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  recoveryIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

export class Worker {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly recoveryIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private running = false;
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly queue: TaskQueue,
    private readonly handlers: ReadonlyMap<string, TaskHandler>,
    options: WorkerOptions = {}
  ) {
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.recoveryIntervalMs = options.recoveryIntervalMs ?? 30_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.recoveryTimer = setInterval(() => {
      void this.queue.recoverStaleTasks().catch(() => undefined);
    }, this.recoveryIntervalMs);

    try {
      while (this.running) {
        const task = await this.queue.claim(this.workerId, [...this.handlers.keys()]);
        if (!task) {
          await sleep(this.pollIntervalMs);
          continue;
        }

        const handler = this.handlers.get(task.taskType);
        if (!handler) {
          await this.queue.fail(task.id, this.workerId, `No handler registered for task type: ${task.taskType}`);
          continue;
        }

        const heartbeatTimer = setInterval(() => {
          void this.queue.heartbeat(task.id, this.workerId).catch(() => undefined);
        }, this.heartbeatIntervalMs);

        try {
          await handler(task);
          await this.queue.succeed(task.id, this.workerId);
        } catch (error) {
          try {
            await this.queue.fail(task.id, this.workerId, error instanceof Error ? error.message : String(error));
          } catch {
            // The lease may have expired and another worker may have recovered the task.
          }
        } finally {
          clearInterval(heartbeatTimer);
        }
      }
    } finally {
      if (this.recoveryTimer) clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  stop(): void {
    this.running = false;
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
