export type SourceStatus = "APPROVED" | "REVIEW_REQUIRED" | "DISABLED";

export type SourceType = "api" | "rss" | "ats" | "structured-data" | "web";

export interface SourcePolicy {
  readonly status: SourceStatus;
  readonly allowedSourceTypes: readonly SourceType[];
}

export interface SourceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly type: SourceType;
  readonly policy: SourcePolicy;
}

export function isSourceRunnable(source: SourceDescriptor): boolean {
  return (
    source.policy.status === "APPROVED" &&
    source.policy.allowedSourceTypes.includes(source.type)
  );
}
