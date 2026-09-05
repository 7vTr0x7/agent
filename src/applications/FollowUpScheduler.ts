import { FollowUpPolicy } from "./FollowUpPolicy";
import { FollowUpDraftRepository } from "./FollowUpDraftRepository";
import { FollowUpTaskDispatcher } from "./FollowUpTask";

export interface FollowUpScheduleResult {
  scanned: number;
  due: number;
  queued: number;
}

export class FollowUpScheduler {
  constructor(
    private readonly repository: FollowUpDraftRepository,
    private readonly dispatcher: FollowUpTaskDispatcher,
    private readonly policy = new FollowUpPolicy()
  ) {}

  async runOnce(now = new Date()): Promise<FollowUpScheduleResult> {
    const candidates = await this.repository.findCandidates();
    let due = 0;
    let queued = 0;

    for (const candidate of candidates) {
      const decision = this.policy.decide({
        status: candidate.status,
        appliedAt: candidate.appliedAt,
        lastFollowUpAt: candidate.lastFollowUpAt,
        nextFollowUpAt: candidate.nextFollowUpAt,
        hasRecruiterResponse: candidate.hasRecruiterResponse,
        now
      });

      if (!decision.shouldFollowUp) continue;

      due += 1;
      const marked = await this.repository.markDue(candidate.applicationId, decision.nextFollowUpAt);
      if (!marked) continue;

      await this.dispatcher.enqueue(candidate.applicationId);
      queued += 1;
    }

    return { scanned: candidates.length, due, queued };
  }
}
