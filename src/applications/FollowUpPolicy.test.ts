import { FollowUpPolicy } from "./FollowUpPolicy";

describe("FollowUpPolicy", () => {
  const policy = new FollowUpPolicy();
  const now = new Date("2026-09-10T10:00:00.000Z");

  test("does not follow up after a recruiter response", () => {
    const result = policy.decide({
      status: "RESPONDED",
      appliedAt: new Date("2026-09-01T10:00:00.000Z"),
      lastFollowUpAt: null,
      nextFollowUpAt: null,
      hasRecruiterResponse: true,
      now
    });

    expect(result.shouldFollowUp).toBe(false);
  });

  test("does not follow up before the waiting period", () => {
    const result = policy.decide({
      status: "SENT",
      appliedAt: new Date("2026-09-07T10:00:00.000Z"),
      lastFollowUpAt: null,
      nextFollowUpAt: null,
      hasRecruiterResponse: false,
      now
    });

    expect(result.shouldFollowUp).toBe(false);
    expect(result.nextFollowUpAt).toEqual(new Date("2026-09-14T10:00:00.000Z"));
  });

  test("marks a follow-up due after the waiting period", () => {
    const result = policy.decide({
      status: "SENT",
      appliedAt: new Date("2026-09-01T10:00:00.000Z"),
      lastFollowUpAt: null,
      nextFollowUpAt: null,
      hasRecruiterResponse: false,
      now
    });

    expect(result.shouldFollowUp).toBe(true);
    expect(result.reason).toContain("due");
  });

  test("never follows up after rejection or closure", () => {
    for (const status of ["REJECTED", "WITHDRAWN", "CLOSED"]) {
      const result = policy.decide({
        status,
        appliedAt: new Date("2026-08-01T10:00:00.000Z"),
        lastFollowUpAt: null,
        nextFollowUpAt: null,
        hasRecruiterResponse: false,
        now
      });

      expect(result.shouldFollowUp).toBe(false);
    }
  });
});
