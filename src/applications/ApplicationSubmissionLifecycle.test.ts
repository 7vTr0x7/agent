import { normalizeApplicationSubmissionResult } from "./ApplicationAdapter";

describe("application submission lifecycle contract", () => {
  const baseEvidence = {
    requestObserved: false,
    requestSentAt: null,
    responseObserved: false,
    responseReceivedAt: null,
    responseStatus: null,
    finalUrl: "https://jobs.example.com/apply/123"
  };

  it("maps confirmed success only when real confirmation metadata exists", () => {
    const result = normalizeApplicationSubmissionResult({
      submitted: true,
      externalApplicationId: "APP-123",
      confirmationUrl: "https://jobs.example.com/confirmation/123",
      reason: "Application submitted."
    }, baseEvidence);
    expect(result.outcome).toBe("CONFIRMED_SUCCESS");
    expect(result.submitted).toBe(true);
  });

  it("maps explicit definitive failure to failure rather than ambiguity", () => {
    const result = normalizeApplicationSubmissionResult({
      submitted: false,
      outcome: "DEFINITIVE_FAILURE",
      externalApplicationId: null,
      confirmationUrl: null,
      reason: "Platform explicitly rejected the submission."
    }, baseEvidence);
    expect(result.outcome).toBe("DEFINITIVE_FAILURE");
    expect(result.submitted).toBe(false);
  });

  it("maps a pre-submission timeout with no observed request to NOT_SUBMITTED", () => {
    const result = normalizeApplicationSubmissionResult({
      submitted: false,
      externalApplicationId: null,
      confirmationUrl: null,
      reason: "Submission request timed out before dispatch."
    }, baseEvidence);
    expect(result.outcome).toBe("NOT_SUBMITTED");
  });

  it("maps a post-submission timeout with an observed request to AMBIGUOUS", () => {
    const result = normalizeApplicationSubmissionResult({
      submitted: false,
      externalApplicationId: null,
      confirmationUrl: null,
      reason: "Confirmation request timed out."
    }, { ...baseEvidence, requestObserved: true, requestSentAt: new Date(), responseObserved: false });
    expect(result.outcome).toBe("AMBIGUOUS");
    expect(result.submitted).toBe(false);
  });

  it("never treats a missing confirmation as success even if an adapter says submitted", () => {
    const result = normalizeApplicationSubmissionResult({
      submitted: true,
      externalApplicationId: null,
      confirmationUrl: null,
      reason: "Submit button click completed."
    }, { ...baseEvidence, requestObserved: true });
    expect(result.outcome).toBe("AMBIGUOUS");
    expect(result.submitted).toBe(false);
  });

  it("maps an explicit ambiguous adapter result to AMBIGUOUS", () => {
    const result = normalizeApplicationSubmissionResult({
      submitted: false,
      outcome: "AMBIGUOUS",
      externalApplicationId: null,
      confirmationUrl: null,
      reason: "Network failure after submit."
    }, { ...baseEvidence, requestObserved: true });
    expect(result.outcome).toBe("AMBIGUOUS");
  });

  it("refuses to classify NOT_SUBMITTED when a non-GET submission request was observed", () => {
    const result = normalizeApplicationSubmissionResult({
      submitted: false,
      outcome: "NOT_SUBMITTED",
      externalApplicationId: null,
      confirmationUrl: null,
      reason: "Adapter could not confirm completion."
    }, { ...baseEvidence, requestObserved: true });
    expect(result.outcome).toBe("AMBIGUOUS");
  });
});
