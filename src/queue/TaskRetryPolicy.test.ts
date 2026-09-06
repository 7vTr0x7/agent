import { calculateRetryDelayMs } from "./TaskRetryPolicy";

describe("calculateRetryDelayMs", () => {
  it("uses exponential delays when jitter is disabled", () => {
    expect(calculateRetryDelayMs(1, { jitterRatio: 0 })).toBe(5_000);
    expect(calculateRetryDelayMs(2, { jitterRatio: 0 })).toBe(10_000);
    expect(calculateRetryDelayMs(3, { jitterRatio: 0 })).toBe(20_000);
  });

  it("caps the exponential delay", () => {
    expect(
      calculateRetryDelayMs(10, {
        baseDelayMs: 1_000,
        maxDelayMs: 5_000,
        jitterRatio: 0
      })
    ).toBe(5_000);
  });

  it("applies bounded jitter", () => {
    const options = { baseDelayMs: 10_000, maxDelayMs: 60_000, jitterRatio: 0.2 };
    expect(calculateRetryDelayMs(2, options, () => 0)).toBe(16_000);
    expect(calculateRetryDelayMs(2, options, () => 1)).toBe(24_000);
  });

  it("rejects invalid attempts and configuration", () => {
    expect(() => calculateRetryDelayMs(0)).toThrow("positive integer");
    expect(() => calculateRetryDelayMs(1, { baseDelayMs: 10, maxDelayMs: 5 })).toThrow("bounds");
    expect(() => calculateRetryDelayMs(1, { jitterRatio: 2 })).toThrow("between 0 and 1");
  });
});
