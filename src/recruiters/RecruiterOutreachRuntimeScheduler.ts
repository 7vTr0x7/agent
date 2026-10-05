import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { RecruiterOutreachFollowUpScheduler } from "./RecruiterOutreachFollowUpScheduler";
import { RecruiterOutreachSendReconciliationService } from "./RecruiterOutreachSendReconciliationService";
import { RecruiterOutreachSendTaskDispatcher } from "./RecruiterOutreachSendTask";

export interface RecruiterOutreachRuntimeSchedulerResult {
  followUps: { prepared: number; queued: number; failed: number };
  reconciliation: { inspected: number; reconciled: number; unresolved: number };
  preparedSend: { inspected: number; queued: number; failed: number };
}

export interface RecruiterOutreachRuntimeLogger {
  info: (payload: unknown, message: string) => void;
  error: (payload: unknown, message: string) => void;
}

/** Runs recovery-oriented recruiter maintenance without allowing one maintenance task to stop the other. */
export class RecruiterOutreachRuntimeScheduler {
  constructor(
    private readonly repository: RecruiterDiscoveryRepository,
    private readonly followUpScheduler: RecruiterOutreachFollowUpScheduler | undefined,
    private readonly reconciliationService: RecruiterOutreachSendReconciliationService | undefined,
    private readonly logger: RecruiterOutreachRuntimeLogger,
    private readonly sendDispatcher?: RecruiterOutreachSendTaskDispatcher,
    private readonly maxMessagesPerDay = 1,
    private readonly maxMessagesPerHour = 1,
  ) {}

  async runOnce(): Promise<RecruiterOutreachRuntimeSchedulerResult> {
    const followUps = { prepared: 0, queued: 0, failed: 0 };
    const reconciliation = { inspected: 0, reconciled: 0, unresolved: 0 };
    const preparedSend = { inspected: 0, queued: 0, failed: 0 };

    if (this.reconciliationService) {
      try {
        const result = await this.reconciliationService.runOnce();
        Object.assign(reconciliation, result);
        if (result.reconciled > 0 || result.unresolved > 0) {
          this.logger.info(result, "Recruiter outreach send reconciliation completed");
        }
      } catch (error) {
        this.logger.error(error, "Recruiter outreach send reconciliation failed");
      }
    }

    if (this.followUpScheduler) {
      try {
        const result = await this.followUpScheduler.runOnce();
        Object.assign(followUps, result);
        if (result.queued > 0 || result.failed > 0) {
          this.logger.info(result, "Recruiter outreach follow-up scheduling completed");
        }
      } catch (error) {
        this.logger.error(error, "Recruiter outreach follow-up scheduling failed");
      }
    }

    if (this.sendDispatcher) {
      try {
        const messages = await this.repository.listPreparedOutreachMessagesForSend(10, this.maxMessagesPerDay, this.maxMessagesPerHour);
        preparedSend.inspected = messages.length;
        for (const message of messages) {
          try {
            await this.sendDispatcher.enqueue({ messageId: message.id, companyDomain: message.companyDomain });
            preparedSend.queued += 1;
          } catch (error) {
            preparedSend.failed += 1;
            this.logger.error({ messageId: message.id, error: error instanceof Error ? error.message : String(error) }, "Failed to queue prepared recruiter outreach");
          }
        }
        this.logger.info(preparedSend, "Recruiter prepared-outreach queue pump completed");
      } catch (error) {
        this.logger.error({ error: error instanceof Error ? error.message : String(error) }, "Recruiter prepared-outreach queue pump failed");
      }
    }

    return { followUps, reconciliation, preparedSend };
  }
}
