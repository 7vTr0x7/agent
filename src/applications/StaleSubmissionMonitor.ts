import { ApplicationRepository, StaleSubmission } from "./ApplicationRepository";

export interface StaleSubmissionMonitorLogger {
  info(meta: Record<string, unknown>, message: string): void;
  warn(meta: Record<string, unknown>, message: string): void;
}

export interface StaleSubmissionMonitorResult {
  staleCount: number;
  submissions: readonly StaleSubmission[];
  /** @deprecated Stale submissions are never blindly requeued. */
  requeued: number;
}

/**
 * Reconciles durable submission attempts without ever retrying an ambiguous
 * external submission. A stale attempt can become READY only when its durable
 * lifecycle proves that no external submission request was made.
 */
export class StaleSubmissionMonitor {
  constructor(
    private readonly applicationRepository: Pick<ApplicationRepository, "listStaleSubmissions"> &
      Partial<Pick<ApplicationRepository, "reconcileStaleSubmissions">>,
    private readonly logger: StaleSubmissionMonitorLogger,
    private readonly olderThanMinutes: number
  ) {
    if (!Number.isFinite(olderThanMinutes) || olderThanMinutes <= 0) {
      throw new Error("olderThanMinutes must be a positive finite number.");
    }
  }

  async runOnce(_olderThanMinutesOverride?: number): Promise<StaleSubmissionMonitorResult> {
    const submissions = await this.applicationRepository.listStaleSubmissions(this.olderThanMinutes);

    if (submissions.length > 0) {
      const reconciliation = this.applicationRepository.reconcileStaleSubmissions
        ? await this.applicationRepository.reconcileStaleSubmissions(this.olderThanMinutes)
        : null;
      this.logger.warn(
        {
          staleCount: submissions.length,
          applicationIds: submissions.map((submission) => submission.applicationId),
          reconciliation
        },
        "Stale application submissions reconciled from persisted evidence; ambiguous outcomes are not retried"
      );

      for (const submission of submissions) {
        this.logger.warn(
          {
            applicationId: submission.applicationId,
            candidateProfileId: submission.candidateProfileId,
            companyName: submission.companyName,
            startedAt: submission.startedAt.toISOString()
          },
          "Application submission requires durable reconciliation"
        );
      }
    } else {
      this.logger.info({ staleCount: 0 }, "Stale application submission check completed");
    }

    return { staleCount: submissions.length, submissions, requeued: 0 };
  }
}
