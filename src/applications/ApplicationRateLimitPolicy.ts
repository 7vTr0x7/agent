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
  constructor(private readonly config: ApplicationRateLimitPolicyConfig) {
    if (!Number.isInteger(config.maxSubmissionsPerDay) || config.maxSubmissionsPerDay <= 0) {
      throw new Error("maxSubmissionsPerDay must be a positive integer");
    }
  }

  evaluate(submissionsInWindow: number): ApplicationRateLimitDecision {
    if (!Number.isInteger(submissionsInWindow) || submissionsInWindow < 0) {
      throw new Error("submissionsInWindow must be a non-negative integer");
    }

    const remaining = Math.max(0, this.config.maxSubmissionsPerDay - submissionsInWindow);
    const allowed = submissionsInWindow < this.config.maxSubmissionsPerDay;

    return {
      allowed,
      used: submissionsInWindow,
      limit: this.config.maxSubmissionsPerDay,
      remaining,
      reason: allowed
        ? undefined
        : `Daily application submission limit reached (${this.config.maxSubmissionsPerDay}).`
    };
  }
}
