import { RecruiterOutreachFollowUpScheduler } from "./RecruiterOutreachFollowUpScheduler";
import { RecruiterOutreachSendReconciliationService } from "./RecruiterOutreachSendReconciliationService";

export interface RecruiterOutreachRuntimeSchedulerResult {
  followUps: { prepared: number; queued: number };
  reconciliation: { inspected: number; reconciled: number; unresolved: number };
}

export interface RecruiterOutreachRuntimeLogger {
  info: (payload: unknown, message: string) => void;
  error: (payload: unknown, message: string) => void;
}

/** Runs recovery-oriented recruiter maintenance without allowing one maintenance task to stop the other. */
export class RecruiterOutreachRuntimeScheduler {
  constructor(
    private readonly followUpScheduler: RecruiterOutreachFollowUpScheduler | undefined,
    private readonly reconciliationService: RecruiterOutreachSendReconciliationService | undefined,
    private readonly logger: RecruiterOutreachRuntimeLogger,
  ) {}

  async runOnce(): Promise<RecruiterOutreachRuntimeSchedulerResult> {
    const followUps = { prepared: 0, queued: 0 };
    const reconciliation = { inspected: 0, reconciled: 0, unresolved: 0 };

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
        if (result.queued > 0) {
          this.logger.info(result, "Recruiter outreach follow-up scheduling completed");
        }
      } catch (error) {
        this.logger.error(error, "Recruiter outreach follow-up scheduling failed");
      }
    }

    return { followUps, reconciliation };
  }
}
