import { randomUUID } from "node:crypto";
import { ClaimedTask, TaskQueue } from "./TaskQueue";

export type TaskHandler<TPayload = Record<string, unknown>> = (
  task: ClaimedTask<TPayload>
) => Promise<void>;

export interface WorkerOptions {
  workerId?: string;
  pollIntervalMs?: number;
}

export class Worker {
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private running = false;

  constructor(
    private readonly queue: TaskQueue,
    private readonly handlers: ReadonlyMap<string, TaskHandler>,
    options: WorkerOptions = {}
  ) {
    this.workerId = options.workerId ?? `worker-${randomUUID()}`;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

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

      try {
        await handler(task);
        await this.queue.succeed(task.id, this.workerId);
      } catch (error) {
        await this.queue.fail(
          task.id,
          this.workerId,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
