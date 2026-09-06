import { TaskQueue } from "./TaskQueue";
import { TaskWorker } from "./TaskWorker";

describe("TaskWorker", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("heartbeats a claimed task while its handler is running", async () => {
    jest.useFakeTimers();

    let resolveHandler: (() => void) | undefined;
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });

    const task = {
      id: "task-1",
      taskType: "test",
      payload: {},
      status: "RUNNING" as const,
      priority: 0,
      availableAt: new Date(),
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      lockedBy: "worker-1",
      attempts: 1,
      maxAttempts: 3,
      dedupeKey: null,
      workerId: "worker-1"
    };

    const queue = {
      recoverStaleTasks: jest.fn().mockResolvedValue({ recovered: 0 }),
      claim: jest.fn().mockResolvedValue(task),
      heartbeat: jest.fn().mockResolvedValue(true),
      succeed: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue("PENDING")
    } as unknown as TaskQueue;

    const worker = new TaskWorker(
      queue,
      new Map([
        [
          "test",
          {
            handle: jest.fn().mockReturnValue(handlerPromise)
          }
        ]
      ]),
      { workerId: "worker-1", staleRecoveryIntervalMs: 60_000, heartbeatIntervalMs: 1_000 }
    );

    const runPromise = worker.runOnce();

    await Promise.resolve();
    await Promise.resolve();
    expect(queue.heartbeat).not.toHaveBeenCalled();

    jest.advanceTimersByTime(3_000);
    expect(queue.heartbeat).toHaveBeenCalledTimes(3);
    expect(queue.heartbeat).toHaveBeenNthCalledWith(1, "task-1", "worker-1");

    resolveHandler!();
    await runPromise;

    jest.advanceTimersByTime(2_000);
    expect(queue.heartbeat).toHaveBeenCalledTimes(3);
    expect(queue.succeed).toHaveBeenCalledWith("task-1", "worker-1");
  });

  it("does not fail the worker loop when a task lease is lost", async () => {
    const task = {
      id: "task-2",
      taskType: "test",
      payload: {},
      status: "RUNNING" as const,
      priority: 0,
      availableAt: new Date(),
      lockedAt: new Date(),
      leaseExpiresAt: new Date(),
      lockedBy: "worker-2",
      attempts: 1,
      maxAttempts: 3,
      dedupeKey: null,
      workerId: "worker-2"
    };

    const queue = {
      recoverStaleTasks: jest.fn().mockResolvedValue({ recovered: 0 }),
      claim: jest.fn().mockResolvedValue(task),
      heartbeat: jest.fn().mockResolvedValue(false),
      succeed: jest.fn().mockRejectedValue(new Error("Task is not owned by this worker")),
      fail: jest.fn().mockRejectedValue(new Error("Task is not owned by this worker"))
    } as unknown as TaskQueue;

    const worker = new TaskWorker(
      queue,
      new Map([["test", { handle: jest.fn().mockRejectedValue(new Error("handler failed")) }]]),
      { workerId: "worker-2", staleRecoveryIntervalMs: 60_000 }
    );

    await expect(worker.runOnce()).resolves.toBe(true);
  });
});
