export type FollowUpDecision =
  | { shouldFollowUp: false; reason: string; nextFollowUpAt: Date | null }
  | { shouldFollowUp: true; reason: string; nextFollowUpAt: Date };

export interface FollowUpInput {
  status: string;
  appliedAt: Date | null;
  lastFollowUpAt: Date | null;
  nextFollowUpAt: Date | null;
  hasRecruiterResponse: boolean;
  now?: Date;
  minimumWaitDays?: number;
}

export class FollowUpPolicy {
  decide(input: FollowUpInput): FollowUpDecision {
    const now = input.now ?? new Date();
    const minimumWaitDays = input.minimumWaitDays ?? 7;
    const waitMs = minimumWaitDays * 24 * 60 * 60 * 1000;

    if (["REJECTED", "WITHDRAWN", "CLOSED", "RESPONDED"].includes(input.status)) {
      return { shouldFollowUp: false, reason: "Application is no longer eligible for an automated follow-up.", nextFollowUpAt: null };
    }

    if (input.hasRecruiterResponse) {
      return { shouldFollowUp: false, reason: "Recruiter has already responded; keep the conversation human-led.", nextFollowUpAt: null };
    }

    if (!input.appliedAt) {
      return { shouldFollowUp: false, reason: "Application has no applied timestamp.", nextFollowUpAt: null };
    }

    const baseline = input.lastFollowUpAt ?? input.appliedAt;
    const next = input.nextFollowUpAt ?? new Date(baseline.getTime() + waitMs);

    if (next > now) {
      return { shouldFollowUp: false, reason: "Follow-up window has not opened yet.", nextFollowUpAt: next };
    }

    return {
      shouldFollowUp: true,
      reason: "Application is due for a follow-up.",
      nextFollowUpAt: new Date(now.getTime() + waitMs)
    };
  }
}
