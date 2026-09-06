import { randomUUID } from "node:crypto";
import { ClaimedTask, TaskQueue } from "./TaskQueue";

export interface TaskHandler<TPayload = Record<string, unknown>> {
  handle(task: ClaimedTask<TPayload>): Promise<void>;
}

export type TaskHandlerRegistry = ReadonlyMap<string, TaskHandler<any>>;

export interface TaskWorkerLogger {
  info(bindings: Record<string, unknown>, message: string): void;
  info(message: string): void;
  warn(bindings: Record<string, unknown>, message: string): void;
  error(bindings: Record<string, unknown>, message: string): void;
}

export interface TaskWorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
  staleRecoveryIntervalMs?: number;
  heartbeatIntervalMs?: number;
  logger?: TaskWorkerLogger;
}

const noopLogger: TaskWorkerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

export class TaskWorker {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly staleRecoveryIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly logger: TaskWorkerLogger;
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
    this.logger = options.logger ?? noopLogger;
  }

  async runOnce(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastRecoveryAt >= this.staleRecoveryIntervalMs) {
      const recovery = await this.queue.recoverStaleTasks();
      this.lastRecoveryAt = now;
      if (recovery.recovered > 0) {
        this.logger.info(
          { workerId: this.workerId, recovered: recovery.recovered },
          "Recovered stale tasks"
        );
      }
    }

    const task = await this.queue.claim(this.workerId);
    if (!task) return false;

    this.logger.info(
      { workerId: this.workerId, taskId: task.id, taskType: task.taskType, attempt: task.attempts },
      "Task claimed"
    );

    const handler = this.handlers.get(task.taskType);
    if (!handler) {
      const reason = `No handler registered for task type '${task.taskType}'.`;
      this.logger.error(
        { workerId: this.workerId, taskId: task.id, taskType: task.taskType, reason },
        "Task failed: handler missing"
      );
      await this.queue.fail(task.id, this.workerId, reason);
      return true;
    }

    const heartbeatTimer = setInterval(() => {
      void this.queue.heartbeat(task.id, this.workerId).then((owned) => {
        if (!owned) {
          this.logger.warn(
            { workerId: this.workerId, taskId: task.id, taskType: task.taskType },
            "Task heartbeat lost ownership"
          );
        }
      }).catch((error: unknown) => {
        this.logger.warn(
          {
            workerId: this.workerId,
            taskId: task.id,
            taskType: task.taskType,
            error: error instanceof Error ? error.message : String(error)
          },
          "Task heartbeat failed"
        );
      });
    }, this.heartbeatIntervalMs);

    try {
      await handler.handle(task);
      await this.queue.succeed(task.id, this.workerId);
      this.logger.info(
        { workerId: this.workerId, taskId: task.id, taskType: task.taskType },
        "Task completed"
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { workerId: this.workerId, taskId: task.id, taskType: task.taskType, reason },
        "Task handler failed"
      );
      try {
        await this.queue.fail(task.id, this.workerId, reason);
      } catch {
        this.logger.warn(
          { workerId: this.workerId, taskId: task.id, taskType: task.taskType },
          "Task failure could not be persisted because the lease is no longer owned"
        );
        // The lease may have expired and the task may already have been recovered.
      }
    } finally {
      clearInterval(heartbeatTimer);
    }

    return true;
  }

  async run(): Promise<void> {
    this.stopped = false;
    this.logger.info({ workerId: this.workerId }, "Task worker started");

    while (!this.stopped) {
      const processed = await this.runOnce();
      if (!processed) {
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }
    }

    this.logger.info({ workerId: this.workerId }, "Task worker stopped");
  }

  stop(): void {
    this.stopped = true;
  }
}
