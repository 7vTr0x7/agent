import { ApplicationCompanyRateLimitPolicy } from "./ApplicationCompanyRateLimitPolicy";

describe("ApplicationCompanyRateLimitPolicy", () => {
  it("defaults to five submissions per company per day", () => {
    const policy = new ApplicationCompanyRateLimitPolicy();

    expect(policy.maxSubmissionsPerCompanyPerDay).toBe(5);
    expect(policy.remaining(2)).toBe(3);
  });

  it("returns zero remaining once the company limit is reached", () => {
    const policy = new ApplicationCompanyRateLimitPolicy({
      maxSubmissionsPerCompanyPerDay: 3
    });

    expect(policy.remaining(3)).toBe(0);
    expect(policy.remaining(5)).toBe(0);
  });

  it("rejects invalid configuration and usage", () => {
    expect(
      () => new ApplicationCompanyRateLimitPolicy({ maxSubmissionsPerCompanyPerDay: 0 })
    ).toThrow("maxSubmissionsPerCompanyPerDay must be a positive integer");

    const policy = new ApplicationCompanyRateLimitPolicy();
    expect(() => policy.remaining(-1)).toThrow("submissionsUsed must be a non-negative integer");
  });
});
