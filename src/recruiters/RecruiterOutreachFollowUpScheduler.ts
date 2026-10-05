import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";

export interface RecruiterOutreachFollowUpSchedulerResult {
  prepared: number;
  queued: number;
  failed: number;
}

export class RecruiterOutreachFollowUpScheduler {
  constructor(
    private readonly repository: RecruiterDiscoveryRepository,
    private readonly _sendDispatcher: unknown,
    private readonly enabled: boolean,
    private readonly batchSize = 10
  ) {}

  async runOnce(): Promise<RecruiterOutreachFollowUpSchedulerResult> {
    if (!this.enabled) return { prepared: 0, queued: 0, failed: 0 };

    const messages = await this.repository.prepareDueRecruiterFollowUps(this.batchSize);

    // Follow-ups are prepared here but deliberately NOT enqueued directly.
    // RecruiterOutreachRuntimeScheduler is the single rate-limited dispatch gate.
    return { prepared: messages.length, queued: 0, failed: 0 };
  }
}
