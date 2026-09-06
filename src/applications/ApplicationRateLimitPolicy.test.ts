import { ApplicationRateLimitPolicy } from "./ApplicationRateLimitPolicy";

describe("ApplicationRateLimitPolicy", () => {
  it("allows submissions below the daily limit", () => {
    const policy = new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 10 });

    expect(policy.evaluate(4)).toEqual({
      allowed: true,
      used: 4,
      limit: 10,
      remaining: 6,
      reason: undefined
    });
  });

  it("blocks submissions at the daily limit", () => {
    const policy = new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 10 });

    expect(policy.evaluate(10)).toEqual({
      allowed: false,
      used: 10,
      limit: 10,
      remaining: 0,
      reason: "Daily application submission limit reached (10)."
    });
  });

  it("rejects invalid configuration and counts", () => {
    expect(() => new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 0 })).toThrow(
      "maxSubmissionsPerDay must be a positive integer"
    );

    const policy = new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 10 });
    expect(() => policy.evaluate(-1)).toThrow("submissionsInWindow must be a non-negative integer");
  });
});
