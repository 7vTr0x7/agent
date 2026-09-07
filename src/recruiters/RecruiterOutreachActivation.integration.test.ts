import { evaluateRecruiterOutreachActivation } from "./RecruiterOutreachActivationGate";

describe("Recruiter outreach activation boundary", () => {
  it("keeps default-style disabled activation closed", () => {
    expect(evaluateRecruiterOutreachActivation({
      activation: "disabled",
      dryRun: false,
      liveActivationConfirmed: false,
      maxMessagesPerDay: 500,
      maxMessagesPerHour: 21
    })).toEqual({
      allowed: false,
      reason: "Recruiter outreach activation is disabled."
    });
  });

  it("permits only the exact one-message canary envelope", () => {
    expect(evaluateRecruiterOutreachActivation({
      activation: "canary",
      dryRun: false,
      liveActivationConfirmed: false,
      maxMessagesPerDay: 1,
      maxMessagesPerHour: 1
    }).allowed).toBe(true);

    expect(evaluateRecruiterOutreachActivation({
      activation: "canary",
      dryRun: false,
      liveActivationConfirmed: false,
      maxMessagesPerDay: 2,
      maxMessagesPerHour: 1
    }).allowed).toBe(false);
  });

  it("requires explicit live confirmation", () => {
    expect(evaluateRecruiterOutreachActivation({
      activation: "live",
      dryRun: false,
      liveActivationConfirmed: false,
      maxMessagesPerDay: 500,
      maxMessagesPerHour: 21
    }).allowed).toBe(false);

    expect(evaluateRecruiterOutreachActivation({
      activation: "live",
      dryRun: false,
      liveActivationConfirmed: true,
      maxMessagesPerDay: 500,
      maxMessagesPerHour: 21
    }).allowed).toBe(true);
  });
});
