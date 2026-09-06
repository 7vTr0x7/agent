import { randomUUID } from "node:crypto";
import { ClaimedTask, TaskQueue } from "./TaskQueue";

export interface TaskHandler<TPayload = Record<string, unknown>> {
  handle(task: ClaimedTask<TPayload>): Promise<void>;
}

export type TaskHandlerRegistry = ReadonlyMap<string, TaskHandler<any>>;

export interface TaskWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  staleRecoveryIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

export class TaskWorker {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly staleRecoveryIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private stopped = false;
  private lastRecoveryAt = 0;

  constructor(
    private readonly queue: TaskQueue,
    private readonly handlers: TaskHandlerRegistry,
    options: TaskWorkerOptions = {}
  ) {
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.staleRecoveryIntervalMs = options.staleRecoveryIntervalMs ?? 30_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 20_000;
  }

  async runOnce(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastRecoveryAt >= this.staleRecoveryIntervalMs) {
      await this.queue.recoverStaleTasks();
      this.lastRecoveryAt = now;
    }

    const task = await this.queue.claim(this.workerId);
    if (!task) return false;

    const handler = this.handlers.get(task.taskType);
    if (!handler) {
      await this.queue.fail(
        task.id,
        this.workerId,
        `No handler registered for task type '${task.taskType}'.`
      );
      return true;
    }

    const heartbeatTimer = setInterval(() => {
      void this.queue.heartbeat(task.id, this.workerId).catch(() => undefined);
    }, this.heartbeatIntervalMs);

    try {
      await handler.handle(task);
      await this.queue.succeed(task.id, this.workerId);
    } catch (error) {
      try {
        await this.queue.fail(
          task.id,
          this.workerId,
          error instanceof Error ? error.message : String(error)
        );
      } catch {
        // The lease may have expired and the task may already have been recovered.
      }
    } finally {
      clearInterval(heartbeatTimer);
    }

    return true;
  }

  async run(): Promise<void> {
    this.stopped = false;

    while (!this.stopped) {
      const processed = await this.runOnce();
      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }
    }
  }

  stop(): void {
    this.stopped = true;
  }
}
