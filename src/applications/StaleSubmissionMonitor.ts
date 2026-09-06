import { ApplicationRepository, StaleSubmission } from "./ApplicationRepository";

export interface StaleSubmissionMonitorLogger {
  info(meta: Record<string, unknown>, message: string): void;
  warn(meta: Record<string, unknown>, message: string): void;
}

export interface StaleSubmissionMonitorResult {
  staleCount: number;
  submissions: readonly StaleSubmission[];
  /** @deprecated Stale submissions are intentionally never requeued automatically. */
  requeued: number;
}

/**
 * Observes submissions that have remained reserved for too long.
 *
 * This monitor is intentionally read-only: it never retries, cancels, or
 * marks an application as submitted. A stale reservation means the browser
 * outcome is unknown, so recovery must remain an explicit, independently
 * verified operation.
 */
export class StaleSubmissionMonitor {
  constructor(
    private readonly applicationRepository: Pick<ApplicationRepository, "listStaleSubmissions">,
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
      this.logger.warn(
        {
          staleCount: submissions.length,
          applicationIds: submissions.map((submission) => submission.applicationId)
        },
        "Stale application submissions detected; manual verification required"
      );

      for (const submission of submissions) {
        this.logger.warn(
          {
            applicationId: submission.applicationId,
            candidateProfileId: submission.candidateProfileId,
            companyName: submission.companyName,
            startedAt: submission.startedAt.toISOString()
          },
          "Application submission remains in progress"
        );
      }
    } else {
      this.logger.info({ staleCount: 0 }, "Stale application submission check completed");
    }

    return { staleCount: submissions.length, submissions, requeued: 0 };
  }
}
