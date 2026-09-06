import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { RecruiterOutreachSendTaskDispatcher } from "./RecruiterOutreachSendTask";

export interface RecruiterOutreachFollowUpSchedulerResult {
  prepared: number;
  queued: number;
}

export class RecruiterOutreachFollowUpScheduler {
  constructor(
    private readonly repository: RecruiterDiscoveryRepository,
    private readonly sendDispatcher: RecruiterOutreachSendTaskDispatcher,
    private readonly enabled: boolean,
    private readonly batchSize = 10
  ) {}

  async runOnce(): Promise<RecruiterOutreachFollowUpSchedulerResult> {
    if (!this.enabled) return { prepared: 0, queued: 0 };

    const messages = await this.repository.prepareDueRecruiterFollowUps(this.batchSize);
    let queued = 0;
    for (const message of messages) {
      await this.sendDispatcher.enqueue({
        messageId: message.id,
        companyDomain: message.companyDomain
      });
      queued += 1;
    }

    return { prepared: messages.length, queued };
  }
}
