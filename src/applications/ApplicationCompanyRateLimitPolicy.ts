export interface ApplicationCompanyRateLimitPolicyOptions {
  maxSubmissionsPerCompanyPerDay?: number;
}

export class ApplicationCompanyRateLimitPolicy {
  readonly maxSubmissionsPerCompanyPerDay: number;

  constructor(options: ApplicationCompanyRateLimitPolicyOptions = {}) {
    const limit = options.maxSubmissionsPerCompanyPerDay ?? 5;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("maxSubmissionsPerCompanyPerDay must be a positive integer");
    }

    this.maxSubmissionsPerCompanyPerDay = limit;
  }

  remaining(submissionsUsed: number): number {
    if (!Number.isInteger(submissionsUsed) || submissionsUsed < 0) {
      throw new Error("submissionsUsed must be a non-negative integer");
    }

    return Math.max(0, this.maxSubmissionsPerCompanyPerDay - submissionsUsed);
  }
}
