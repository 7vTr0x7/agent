import { evaluateRecruiterOutreachActivation } from "./RecruiterOutreachActivationGate";

describe("RecruiterOutreachActivationGate", () => {
  it("keeps dry-run safe regardless of activation", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "live", dryRun: true, liveActivationConfirmed: true, maxMessagesPerDay: 500, maxMessagesPerHour: 21 })).toEqual({ allowed: true, reason: "Dry-run mode is active; real delivery is disabled." });
  });

  it("blocks real delivery while activation is disabled", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "disabled", dryRun: false, liveActivationConfirmed: false, maxMessagesPerDay: 500, maxMessagesPerHour: 21 })).toEqual({ allowed: false, reason: "Recruiter outreach activation is disabled." });
  });

  it("only allows a one-message canary", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "canary", dryRun: false, liveActivationConfirmed: false, maxMessagesPerDay: 1, maxMessagesPerHour: 1 }).allowed).toBe(true);
    expect(evaluateRecruiterOutreachActivation({ activation: "canary", dryRun: false, liveActivationConfirmed: false, maxMessagesPerDay: 500, maxMessagesPerHour: 21 }).allowed).toBe(false);
  });

  it("requires explicit confirmation for live delivery", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "live", dryRun: false, liveActivationConfirmed: false, maxMessagesPerDay: 500, maxMessagesPerHour: 21 }).allowed).toBe(false);
    expect(evaluateRecruiterOutreachActivation({ activation: "live", dryRun: false, liveActivationConfirmed: true, maxMessagesPerDay: 500, maxMessagesPerHour: 21 }).allowed).toBe(true);
  });
});
