import { RetryPolicy } from "./RetryPolicy";

describe("RetryPolicy", () => {
  it("retries transient failures with bounded exponential delay", () => {
    const policy = new RetryPolicy({ baseDelayMs: 100, maxDelayMs: 500, jitterRatio: 0 });

    expect(policy.decide(500, 1)).toEqual({
      retry: true,
      delayMs: 100,
      classification: "TRANSIENT"
    });

    expect(policy.decide(500, 2)).toEqual({
      retry: true,
      delayMs: 200,
      classification: "TRANSIENT"
    });
  });

  it("does not retry permanent client errors", () => {
    const policy = new RetryPolicy();
    const decision = policy.decide(404, 1);

    expect(decision.retry).toBe(false);
    expect(decision.classification).toBe("PERMANENT");
  });

  it("classifies rate limits as retryable", () => {
    const policy = new RetryPolicy({ jitterRatio: 0 });
    const decision = policy.decide(429, 1);

    expect(decision.retry).toBe(true);
    expect(decision.classification).toBe("RATE_LIMIT");
  });

  it("stops after the configured attempt limit", () => {
    const policy = new RetryPolicy({ maxAttempts: 3, jitterRatio: 0 });
    const decision = policy.decide(503, 3);

    expect(decision.retry).toBe(false);
    expect(decision.classification).toBe("TRANSIENT");
  });
});
