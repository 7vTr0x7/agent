import { DiscoveryRunner } from "./DiscoveryRunner";
import { RegisteredSource } from "./sources/SourceRegistry";

describe("DiscoveryRunner", () => {
  const descriptor = {
    id: "greenhouse-example",
    name: "Greenhouse",
    type: "ats" as const,
    policy: { status: "APPROVED" as const, allowedSourceTypes: ["ats"] as const }
  };

  const source = { name: descriptor.id, fetchJobs: jest.fn() };
  const registered: RegisteredSource = { descriptor, source };

  it("discovers runnable sources and dispatches newly inserted opportunities", async () => {
    const discovery = {
      discover: jest.fn().mockResolvedValue({
        source: descriptor.id,
        fetched: 2,
        inserted: 1,
        duplicates: 1,
        insertedOpportunityIds: ["job-1"]
      })
    };
    const health = { canRun: jest.fn().mockResolvedValue(true) };
    const runs = {
      start: jest.fn().mockResolvedValue("run-1"),
      complete: jest.fn().mockResolvedValue(undefined),
      recordError: jest.fn().mockResolvedValue(undefined)
    };
    const matchDispatcher = {
      dispatch: jest.fn().mockResolvedValue({ enqueued: 1, rejected: 0, missing: 0 })
    };

    const runner = new DiscoveryRunner(
      discovery as never,
      health as never,
      runs as never,
      matchDispatcher as never,
      [registered]
    );

    await expect(runner.runOnce()).resolves.toEqual([
      {
        source: descriptor.id,
        discovered: {
          source: descriptor.id,
          fetched: 2,
          inserted: 1,
          duplicates: 1,
          insertedOpportunityIds: ["job-1"]
        },
        matching: { enqueued: 1, rejected: 0, missing: 0 }
      }
    ]);
    expect(runs.start).toHaveBeenCalledWith(descriptor);
    expect(matchDispatcher.dispatch).toHaveBeenCalledWith(["job-1"]);
    expect(runs.complete).toHaveBeenCalledWith(
      "run-1",
      descriptor.id,
      "SUCCEEDED",
      { fetched: 2, inserted: 1, duplicates: 1 }
    );
  });

  it("skips sources blocked by the health gate", async () => {
    const discovery = { discover: jest.fn() };
    const health = { canRun: jest.fn().mockResolvedValue(false) };
    const runs = { start: jest.fn(), complete: jest.fn(), recordError: jest.fn() };
    const matchDispatcher = { dispatch: jest.fn() };

    const runner = new DiscoveryRunner(
      discovery as never,
      health as never,
      runs as never,
      matchDispatcher as never,
      [registered]
    );

    await expect(runner.runOnce()).resolves.toEqual([]);
    expect(discovery.discover).not.toHaveBeenCalled();
    expect(runs.start).not.toHaveBeenCalled();
  });

  it("records a failed source run and continues without crashing the runner", async () => {
    const error = new Error("source unavailable");
    const discovery = { discover: jest.fn().mockRejectedValue(error) };
    const health = { canRun: jest.fn().mockResolvedValue(true) };
    const runs = {
      start: jest.fn().mockResolvedValue("run-1"),
      complete: jest.fn().mockResolvedValue(undefined),
      recordError: jest.fn().mockResolvedValue(undefined)
    };
    const matchDispatcher = { dispatch: jest.fn() };

    const runner = new DiscoveryRunner(
      discovery as never,
      health as never,
      runs as never,
      matchDispatcher as never,
      [registered]
    );

    await expect(runner.runOnce()).resolves.toEqual([]);
    expect(runs.recordError).toHaveBeenCalledWith("run-1", descriptor.id, {
      classification: "UNKNOWN",
      message: "source unavailable"
    });
    expect(runs.complete).toHaveBeenCalledWith(
      "run-1",
      descriptor.id,
      "FAILED",
      { fetched: 0, inserted: 0, duplicates: 0 },
      "source unavailable"
    );
  });
});
