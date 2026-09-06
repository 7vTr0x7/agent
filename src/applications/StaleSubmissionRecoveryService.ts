import {
  ApplicationRepository,
  StaleSubmission,
  SubmittedApplicationResult,
  VerifiedSubmissionEvidence
} from "./ApplicationRepository";

export interface SubmissionEvidenceVerifier {
  verify(
    submission: StaleSubmission,
    evidence: VerifiedSubmissionEvidence
  ): boolean | Promise<boolean>;
}

export interface StaleSubmissionRecoveryResult {
  recovered: boolean;
  reason: string;
  submission: SubmittedApplicationResult | null;
}

export class StaleSubmissionRecoveryService {
  constructor(
    private readonly applications: Pick<ApplicationRepository, "recoverVerifiedSubmission">,
    private readonly verifier: SubmissionEvidenceVerifier
  ) {}

  async recover(
    submission: StaleSubmission,
    olderThanMinutes: number,
    evidence: VerifiedSubmissionEvidence
  ): Promise<StaleSubmissionRecoveryResult> {
    if (!submission.applicationId.trim()) {
      throw new Error("submission.applicationId must not be empty.");
    }

    if (!evidence.confirmationUrl.trim() || !evidence.externalApplicationId.trim()) {
      return {
        recovered: false,
        reason: "Independent confirmation URL and external application ID are both required.",
        submission: null
      };
    }

    const verified = await this.verifier.verify(submission, evidence);
    if (!verified) {
      return {
        recovered: false,
        reason: "Submission evidence could not be independently verified; application remains ambiguous.",
        submission: null
      };
    }

    const recovered = await this.applications.recoverVerifiedSubmission(
      submission.applicationId,
      olderThanMinutes,
      evidence
    );

    if (!recovered) {
      return {
        recovered: false,
        reason: "Application is no longer stale and in progress, or cannot be safely recovered.",
        submission: null
      };
    }

    return {
      recovered: true,
      reason: "Application was marked SENT from independently verified confirmation evidence; no resubmission was performed.",
      submission: recovered
    };
  }
}
