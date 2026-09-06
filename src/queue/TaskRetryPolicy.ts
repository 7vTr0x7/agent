export interface TaskRetryPolicyOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
}

const DEFAULT_BASE_DELAY_MS = 5_000;
const DEFAULT_MAX_DELAY_MS = 5 * 60_000;
const DEFAULT_JITTER_RATIO = 0.2;

export function calculateRetryDelayMs(
  attempt: number,
  options: TaskRetryPolicyOptions = {},
  random = Math.random
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("Retry attempt must be a positive integer.");
  }

  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;

  if (baseDelayMs < 0 || maxDelayMs < 0 || baseDelayMs > maxDelayMs) {
    throw new Error("Retry delay bounds are invalid.");
  }
  if (jitterRatio < 0 || jitterRatio > 1) {
    throw new Error("Retry jitter ratio must be between 0 and 1.");
  }

  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  const jitter = exponentialDelay * jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.min(maxDelayMs, Math.round(exponentialDelay + jitter)));
}
