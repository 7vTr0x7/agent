import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";

export interface RecruiterOutreachFollowUpPolicy {
  dayOffsets: number[];
  enabled: boolean;
}

export interface RecruiterOutreachFollowUpResult {
  status: "SCHEDULED" | "SKIPPED";
  sequenceId: string;
  reason?: string;
}

export class RecruiterOutreachFollowUpService {
  constructor(
    private readonly repository: RecruiterDiscoveryRepository,
    private readonly policy: RecruiterOutreachFollowUpPolicy
  ) {}

  async scheduleNext(sequenceId: string): Promise<RecruiterOutreachFollowUpResult> {
    if (!this.policy.enabled) {
      return { status: "SKIPPED", sequenceId, reason: "Recruiter follow-ups are disabled." };
    }

    const sequence = await this.repository.getOutreachSequence(sequenceId);
    if (!sequence) {
      return { status: "SKIPPED", sequenceId, reason: "Outreach sequence no longer exists." };
    }

    if (sequence.status !== "ACTIVE") {
      return { status: "SKIPPED", sequenceId, reason: `Sequence is not ACTIVE (status=${sequence.status}).` };
    }

    const nextIndex = sequence.followUpCount + 1;
    const dayOffset = this.policy.dayOffsets[nextIndex - 1];
    if (dayOffset === undefined) {
      return { status: "SKIPPED", sequenceId, reason: "No follow-up step remains." };
    }

    const scheduledFor = new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000);
    const created = await this.repository.scheduleNextRecruiterFollowUp(sequenceId, nextIndex, scheduledFor);
    if (!created) {
      return { status: "SKIPPED", sequenceId, reason: "Follow-up was already scheduled or sequence is no longer eligible." };
    }

    return { status: "SCHEDULED", sequenceId };
  }
}
