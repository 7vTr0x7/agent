export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  classification: "TRANSIENT" | "PERMANENT" | "INVALID_DATA" | "RATE_LIMIT" | "UNKNOWN";
}

export interface RetryPolicyOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
}

export class RetryPolicy {
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterRatio: number;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1_000;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.jitterRatio = options.jitterRatio ?? 0.2;
  }

  decide(statusCode: number | undefined, attempt: number): RetryDecision {
    const classification = this.classify(statusCode);
    const retryable = classification === "TRANSIENT" || classification === "RATE_LIMIT";

    if (!retryable || attempt >= this.maxAttempts) {
      return { retry: false, delayMs: 0, classification };
    }

    const exponential = Math.min(
      this.maxDelayMs,
      this.baseDelayMs * 2 ** Math.max(0, attempt - 1)
    );
    const jitter = exponential * this.jitterRatio * Math.random();

    return {
      retry: true,
      delayMs: Math.min(this.maxDelayMs, Math.round(exponential + jitter)),
      classification
    };
  }

  private classify(
    statusCode: number | undefined
  ): RetryDecision["classification"] {
    if (statusCode === 429) return "RATE_LIMIT";
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return statusCode === 408 ? "TRANSIENT" : "PERMANENT";
    }
    if (statusCode !== undefined && statusCode >= 500) return "TRANSIENT";
    return "UNKNOWN";
  }
}
