import { runPeriodicLoop } from "./RuntimeLoop";

describe("runPeriodicLoop", () => {
  it("continues after a failed iteration and stops on abort", async () => {
    const controller = new AbortController();
    const calls: string[] = [];
    const errors: Array<{ loop?: unknown }> = [];
    let attempts = 0;

    const sleep = jest.fn(async (_ms: number, signal: AbortSignal) => {
      calls.push("sleep");
      if (attempts >= 2) controller.abort();
      if (signal.aborted) return;
    });

    await runPeriodicLoop({
      name: "test-loop",
      intervalMs: 10,
      signal: controller.signal,
      logger: {
        error(meta) {
          errors.push(meta);
        }
      },
      sleep,
      runOnce: async () => {
        attempts += 1;
        calls.push(`run:${attempts}`);
        if (attempts === 1) throw new Error("transient failure");
      }
    });

    expect(attempts).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.loop).toBe("test-loop");
    expect(calls).toEqual(["run:1", "sleep", "run:2", "sleep"]);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
