import { StaleSubmissionRecoveryService } from "./StaleSubmissionRecoveryService";
import { StaleSubmission, SubmittedApplicationResult, VerifiedSubmissionEvidence } from "./ApplicationRepository";

describe("StaleSubmissionRecoveryService", () => {
  const submission: StaleSubmission = {
    applicationId: "application-stale-1",
    candidateProfileId: "candidate-1",
    companyName: "Example Co",
    targetUrl: "https://jobs.example.com/apply/123",
    startedAt: new Date("2026-09-06T10:00:00.000Z")
  };

  const evidence: VerifiedSubmissionEvidence = {
    confirmationUrl: "https://jobs.example.com/confirmation/abc",
    externalApplicationId: "APP-123",
    verificationSource: "INDEPENDENT_CONFIRMATION"
  };

  const recovered: SubmittedApplicationResult = {
    applicationId: submission.applicationId,
    confirmationUrl: evidence.confirmationUrl,
    externalApplicationId: evidence.externalApplicationId
  };

  it("recovers a stale submission only after independent verification", async () => {
    const recoverVerifiedSubmission = jest.fn().mockResolvedValue(recovered);
    const verify = jest.fn().mockReturnValue(true);
    const service = new StaleSubmissionRecoveryService(
      { recoverVerifiedSubmission },
      { verify }
    );

    await expect(service.recover(submission, 30, evidence)).resolves.toEqual({
      recovered: true,
      reason: "Application was marked SENT from independently verified confirmation evidence; no resubmission was performed.",
      submission: recovered
    });
    expect(verify).toHaveBeenCalledWith(submission, evidence);
    expect(recoverVerifiedSubmission).toHaveBeenCalledWith(
      submission.applicationId,
      30,
      evidence
    );
  });

  it("leaves ambiguous evidence unrecovered", async () => {
    const recoverVerifiedSubmission = jest.fn();
    const service = new StaleSubmissionRecoveryService(
      { recoverVerifiedSubmission },
      { verify: jest.fn().mockReturnValue(false) }
    );

    await expect(service.recover(submission, 30, evidence)).resolves.toEqual({
      recovered: false,
      reason: "Submission evidence could not be independently verified; application remains ambiguous.",
      submission: null
    });
    expect(recoverVerifiedSubmission).not.toHaveBeenCalled();
  });

  it("accepts an independently verified external application ID without requiring a confirmation URL", async () => {
    const externalOnlyEvidence: VerifiedSubmissionEvidence = {
      confirmationUrl: "",
      externalApplicationId: "APP-456",
      verificationSource: "INDEPENDENT_CONFIRMATION"
    };
    const recoveredExternalOnly: SubmittedApplicationResult = {
      applicationId: submission.applicationId,
      confirmationUrl: "",
      externalApplicationId: externalOnlyEvidence.externalApplicationId
    };
    const recoverVerifiedSubmission = jest.fn().mockResolvedValue(recoveredExternalOnly);
    const verify = jest.fn().mockReturnValue(true);
    const service = new StaleSubmissionRecoveryService(
      { recoverVerifiedSubmission },
      { verify }
    );

    await expect(service.recover(submission, 30, externalOnlyEvidence)).resolves.toEqual({
      recovered: true,
      reason: "Application was marked SENT from independently verified confirmation evidence; no resubmission was performed.",
      submission: recoveredExternalOnly
    });
    expect(verify).toHaveBeenCalledWith(submission, externalOnlyEvidence);
    expect(recoverVerifiedSubmission).toHaveBeenCalledWith(submission.applicationId, 30, externalOnlyEvidence);
  });

  it("rejects evidence when neither independent confirmation signal exists", async () => {
    const recoverVerifiedSubmission = jest.fn();
    const verify = jest.fn();
    const service = new StaleSubmissionRecoveryService(
      { recoverVerifiedSubmission },
      { verify }
    );

    await expect(
      service.recover(submission, 30, {
        confirmationUrl: "",
        externalApplicationId: "",
        verificationSource: "INDEPENDENT_CONFIRMATION"
      })
    ).resolves.toEqual({
      recovered: false,
      reason: "Independent confirmation URL or external application ID is required.",
      submission: null
    });
    expect(verify).not.toHaveBeenCalled();
    expect(recoverVerifiedSubmission).not.toHaveBeenCalled();
  });

  it("does not recover a non-stale or no-longer-in-progress application", async () => {
    const recoverVerifiedSubmission = jest.fn().mockResolvedValue(null);
    const service = new StaleSubmissionRecoveryService(
      { recoverVerifiedSubmission },
      { verify: jest.fn().mockReturnValue(true) }
    );

    await expect(service.recover(submission, 30, evidence)).resolves.toEqual({
      recovered: false,
      reason: "Application is no longer stale and in progress, or cannot be safely recovered.",
      submission: null
    });
  });
});