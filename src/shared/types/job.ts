export type JobDecision = "APPLY" | "REJECT" | "REVIEW";

export interface JobMatchResult {
  matchScore: number;
  decision: JobDecision;
  reason: string;
}
