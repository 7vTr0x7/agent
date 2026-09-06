export interface ApplicationRateLimitPolicyConfig {
  readonly maxSubmissionsPerDay: number;
}

export interface ApplicationRateLimitDecision {
  readonly allowed: boolean;
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly reason?: string;
}

export class ApplicationRateLimitPolicy {
  constructor(private readonly config: ApplicationRateLimitPolicyConfig | number) {
    const limit = typeof config === "number" ? config : config.maxSubmissionsPerDay;
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("maxSubmissionsPerDay must be a positive integer");
    }
  }

  evaluate(submissionsInWindow: number): ApplicationRateLimitDecision {
    if (!Number.isInteger(submissionsInWindow) || submissionsInWindow < 0) {
      throw new Error("submissionsInWindow must be a non-negative integer");
    }

    const limit = typeof this.config === "number" ? this.config : this.config.maxSubmissionsPerDay;
    const remaining = Math.max(0, limit - submissionsInWindow);
    const allowed = submissionsInWindow < limit;

    return {
      allowed,
      used: submissionsInWindow,
      limit,
      remaining,
      reason: allowed
        ? undefined
        : `Daily application submission limit reached (${limit}).`
    };
  }
}
