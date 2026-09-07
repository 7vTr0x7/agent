import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { RecruiterOutreachSendTaskDispatcher } from "./RecruiterOutreachSendTask";

export interface RecruiterOutreachFollowUpSchedulerResult {
  prepared: number;
  queued: number;
  failed: number;
}

export class RecruiterOutreachFollowUpScheduler {
  constructor(
    private readonly repository: RecruiterDiscoveryRepository,
    private readonly sendDispatcher: RecruiterOutreachSendTaskDispatcher,
    private readonly enabled: boolean,
    private readonly batchSize = 10
  ) {}

  async runOnce(): Promise<RecruiterOutreachFollowUpSchedulerResult> {
    if (!this.enabled) return { prepared: 0, queued: 0, failed: 0 };

    const messages = await this.repository.prepareDueRecruiterFollowUps(this.batchSize);
    let queued = 0;
    let failed = 0;

    for (const message of messages) {
      try {
        await this.sendDispatcher.enqueue({
          messageId: message.id,
          companyDomain: message.companyDomain
        });
        queued += 1;
      } catch (error) {
        failed += 1;
        console.error("Failed to queue recruiter follow-up", {
          messageId: message.id,
          companyDomain: message.companyDomain,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return { prepared: messages.length, queued, failed };
  }
}
