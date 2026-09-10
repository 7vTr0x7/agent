import { TaskQueue } from "./TaskQueue";
import { TaskWorker, TaskWorkerLogger } from "./TaskWorker";

describe("TaskWorker", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renews immediately and heartbeats a claimed task while its handler is running", async () => {
    jest.useFakeTimers();

    let resolveHandler: (() => void) | undefined;
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });

    const task = {
      id: "task-1", taskType: "test", payload: {}, status: "RUNNING" as const, priority: 0,
      availableAt: new Date(), lockedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000),
      lockedBy: "worker-1", attempts: 1, maxAttempts: 3, dedupeKey: null, workerId: "worker-1"
    };
    const queue = {
      recoverStaleTasks: jest.fn().mockResolvedValue({ recovered: 0 }), claim: jest.fn().mockResolvedValue(task),
      heartbeat: jest.fn().mockResolvedValue(true), succeed: jest.fn().mockResolvedValue(undefined), fail: jest.fn().mockResolvedValue("PENDING")
    } as unknown as TaskQueue;

    const worker = new TaskWorker(queue, new Map([["test", { handle: jest.fn().mockReturnValue(handlerPromise) }]]),
      { workerId: "worker-1", staleRecoveryIntervalMs: 60_000, heartbeatIntervalMs: 1_000 });
    const runPromise = worker.runOnce();
    await Promise.resolve(); await Promise.resolve();
    expect(queue.heartbeat).toHaveBeenCalledTimes(1);
    expect(queue.heartbeat).toHaveBeenNthCalledWith(1, "task-1", "worker-1");
    await jest.advanceTimersByTimeAsync(3_000);
    expect(queue.heartbeat).toHaveBeenCalledTimes(4);
    expect(queue.heartbeat).toHaveBeenNthCalledWith(4, "task-1", "worker-1");
    resolveHandler!(); await runPromise;
    await jest.advanceTimersByTimeAsync(2_000);
    expect(queue.heartbeat).toHaveBeenCalledTimes(4);
    expect(queue.succeed).toHaveBeenCalledWith("task-1", "worker-1");
    expect(queue.claim).toHaveBeenCalledWith("worker-1", ["test"]);
  });

  it("does not execute a task after the initial lease renewal proves ownership was lost", async () => {
    const task = { id: "task-initial-loss", taskType: "test", payload: {}, status: "RUNNING" as const, priority: 0, availableAt: new Date(), lockedAt: new Date(), leaseExpiresAt: new Date(), lockedBy: "worker-initial-loss", attempts: 1, maxAttempts: 3, dedupeKey: null, workerId: "worker-initial-loss" };
    const queue = { recoverStaleTasks: jest.fn().mockResolvedValue({ recovered: 0 }), claim: jest.fn().mockResolvedValue(task), heartbeat: jest.fn().mockResolvedValue(false), succeed: jest.fn(), fail: jest.fn() } as unknown as TaskQueue;
    const handler = jest.fn().mockResolvedValue(undefined);
    const logger: TaskWorkerLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const worker = new TaskWorker(queue, new Map([["test", { handle: handler }]]), { workerId: "worker-initial-loss", staleRecoveryIntervalMs: 60_000, logger });

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(queue.heartbeat).toHaveBeenCalledWith("task-initial-loss", "worker-initial-loss");
    expect(handler).not.toHaveBeenCalled();
    expect(queue.succeed).not.toHaveBeenCalled();
    expect(queue.fail).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ workerId: "worker-initial-loss", taskId: "task-initial-loss", taskType: "test" }, "Task heartbeat lost ownership");
  });

  it("does not persist success after ownership is lost during handler execution", async () => {
    jest.useFakeTimers();

    let resolveHandler: (() => void) | undefined;
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });
    const task = { id: "task-mid-loss", taskType: "test", payload: {}, status: "RUNNING" as const, priority: 0, availableAt: new Date(), lockedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000), lockedBy: "worker-mid-loss", attempts: 1, maxAttempts: 3, dedupeKey: null, workerId: "worker-mid-loss" };
    const queue = { recoverStaleTasks: jest.fn().mockResolvedValue({ recovered: 0 }), claim: jest.fn().mockResolvedValue(task), heartbeat: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false), succeed: jest.fn(), fail: jest.fn() } as unknown as TaskQueue;
    const logger: TaskWorkerLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const worker = new TaskWorker(queue, new Map([["test", { handle: jest.fn().mockReturnValue(handlerPromise) }]]), { workerId: "worker-mid-loss", staleRecoveryIntervalMs: 60_000, heartbeatIntervalMs: 1_000, logger });

    const runPromise = worker.runOnce();
    await Promise.resolve(); await Promise.resolve();
    expect(queue.heartbeat).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(queue.heartbeat).toHaveBeenCalledTimes(2);
    resolveHandler!();
    await runPromise;

    expect(queue.succeed).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({ workerId: "worker-mid-loss", taskId: "task-mid-loss", taskType: "test" }, "Task finished after lease ownership was lost; completion was not persisted");
  });

  it("logs task lifecycle events without requiring a logger", async () => {
    const task = { id: "task-logging", taskType: "test", payload: {}, status: "RUNNING" as const, priority: 0,
      availableAt: new Date(), lockedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000), lockedBy: "worker-logging", attempts: 2, maxAttempts: 3, dedupeKey: null, workerId: "worker-logging" };
    const queue = { recoverStaleTasks: jest.fn().mockResolvedValue({ recovered: 0 }), claim: jest.fn().mockResolvedValue(task), heartbeat: jest.fn().mockResolvedValue(true), succeed: jest.fn().mockResolvedValue(undefined), fail: jest.fn().mockResolvedValue("PENDING") } as unknown as TaskQueue;
    const logger: TaskWorkerLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const worker = new TaskWorker(queue, new Map([["test", { handle: jest.fn().mockResolvedValue(undefined) }]]), { workerId: "worker-logging", staleRecoveryIntervalMs: 60_000, logger });
    await worker.runOnce();
    expect(logger.info).toHaveBeenCalledWith({ workerId: "worker-logging", taskId: "task-logging", taskType: "test", attempt: 2 }, "Task claimed");
    expect(logger.info).toHaveBeenCalledWith({ workerId: "worker-logging", taskId: "task-logging", taskType: "test" }, "Task completed");
  });

  it("logs handler failure without failing the worker loop", async () => {
    const task = { id: "task-2", taskType: "test", payload: {}, status: "RUNNING" as const, priority: 0, availableAt: new Date(), lockedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000), lockedBy: "worker-2", attempts: 1, maxAttempts: 3, dedupeKey: null, workerId: "worker-2" };
    const queue = { recoverStaleTasks: jest.fn().mockResolvedValue({ recovered: 0 }), claim: jest.fn().mockResolvedValue(task), heartbeat: jest.fn().mockResolvedValue(true), succeed: jest.fn(), fail: jest.fn().mockRejectedValue(new Error("Task is not owned by this worker")) } as unknown as TaskQueue;
    const logger: TaskWorkerLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const worker = new TaskWorker(queue, new Map([["test", { handle: jest.fn().mockRejectedValue(new Error("handler failed")) }]]), { workerId: "worker-2", staleRecoveryIntervalMs: 60_000, logger });
    await expect(worker.runOnce()).resolves.toBe(true);
    expect(logger.error).toHaveBeenCalledWith({ workerId: "worker-2", taskId: "task-2", taskType: "test", reason: "handler failed" }, "Task handler failed");
  });

  it("persists handler failure so a retry can be scheduled", async () => {
    const task = { id: "task-retry", taskType: "test", payload: {}, status: "RUNNING" as const, priority: 10, availableAt: new Date(), lockedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000), lockedBy: "worker-retry", attempts: 1, maxAttempts: 3, dedupeKey: null, workerId: "worker-retry" };
    const queue = { recoverStaleTasks: jest.fn().mockResolvedValue({ recovered: 0 }), claim: jest.fn().mockResolvedValue(task), heartbeat: jest.fn().mockResolvedValue(true), succeed: jest.fn().mockResolvedValue(undefined), fail: jest.fn().mockResolvedValue("PENDING") } as unknown as TaskQueue;
    const worker = new TaskWorker(queue, new Map([["test", { handle: jest.fn().mockRejectedValue(new Error("temporary outage")) }]]), { workerId: "worker-retry", staleRecoveryIntervalMs: 60_000 });
    await expect(worker.runOnce()).resolves.toBe(true);
    expect(queue.fail).toHaveBeenCalledWith("task-retry", "worker-retry", "temporary outage");
    expect(queue.succeed).not.toHaveBeenCalled();
  });

  it("records stale-task recovery and continues processing", async () => {
    const task = { id: "task-after-recovery", taskType: "test", payload: {}, status: "RUNNING" as const, priority: 0, availableAt: new Date(), lockedAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000), lockedBy: "worker-recovery", attempts: 1, maxAttempts: 3, dedupeKey: null, workerId: "worker-recovery" };
    const queue = { recoverStaleTasks: jest.fn().mockResolvedValue({ recovered: 2 }), claim: jest.fn().mockResolvedValue(task), heartbeat: jest.fn().mockResolvedValue(true), succeed: jest.fn().mockResolvedValue(undefined), fail: jest.fn().mockResolvedValue("PENDING") } as unknown as TaskQueue;
    const logger: TaskWorkerLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const worker = new TaskWorker(queue, new Map([["test", { handle: jest.fn().mockResolvedValue(undefined) }]]), { workerId: "worker-recovery", staleRecoveryIntervalMs: 30_000, logger });
    await expect(worker.runOnce()).resolves.toBe(true);
    expect(queue.recoverStaleTasks).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ workerId: "worker-recovery", recovered: 2 }, "Recovered stale tasks");
    expect(queue.claim).toHaveBeenCalledWith("worker-recovery", ["test"]);
    expect(queue.succeed).toHaveBeenCalledWith("task-after-recovery", "worker-recovery");
  });

  it("survives a transient queue iteration error", async () => {
    const queue = {} as TaskQueue;
    const logger: TaskWorkerLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const worker = new TaskWorker(queue, new Map(), { workerId: "worker-resilient", pollIntervalMs: 0, logger });
    const runOnce = jest.spyOn(worker, "runOnce")
      .mockRejectedValueOnce(new Error("database temporarily unavailable"))
      .mockImplementationOnce(async () => {
        worker.stop();
        return false;
      });

    await worker.run();

    expect(runOnce).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      { workerId: "worker-resilient", error: "database temporarily unavailable" },
      "Task worker iteration failed; continuing"
    );
    expect(logger.info).toHaveBeenCalledWith({ workerId: "worker-resilient" }, "Task worker stopped");
  });
});
