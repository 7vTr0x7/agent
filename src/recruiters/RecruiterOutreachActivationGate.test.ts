import { CONTROLLED_SEND_CONFIRMATION, evaluateRecruiterOutreachActivation } from "./RecruiterOutreachActivationGate";

describe("RecruiterOutreachActivationGate", () => {
  const canary = { activation: "canary" as const, dryRun: false, liveActivationConfirmed: false, maxMessagesPerDay: 1, maxMessagesPerHour: 1 };

  it("keeps dry-run safe regardless of activation", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "live", dryRun: true, liveActivationConfirmed: true, maxMessagesPerDay: 500, maxMessagesPerHour: 21 })).toEqual({ allowed: true, reason: "Dry-run mode is active; real delivery is disabled." });
  });

  it("blocks real delivery while activation is disabled", () => {
    expect(evaluateRecruiterOutreachActivation({ ...canary, activation: "disabled" })).toEqual({ allowed: false, reason: "Recruiter outreach activation is disabled." });
  });

  it("requires explicit controlled confirmation for a canary send", () => {
    expect(evaluateRecruiterOutreachActivation(canary).allowed).toBe(false);
    expect(evaluateRecruiterOutreachActivation({ ...canary, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION }).allowed).toBe(true);
    expect(evaluateRecruiterOutreachActivation({ ...canary, controlledSendConfirmation: "WRONG" }).allowed).toBe(false);
  });

  it("only allows a one-message canary", () => {
    expect(evaluateRecruiterOutreachActivation({ ...canary, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION }).allowed).toBe(true);
    expect(evaluateRecruiterOutreachActivation({ ...canary, maxMessagesPerDay: 2, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION }).allowed).toBe(false);
  });

  it("requires explicit confirmation for live delivery", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "live", dryRun: false, liveActivationConfirmed: true, maxMessagesPerDay: 500, maxMessagesPerHour: 21 }).allowed).toBe(false);
    expect(evaluateRecruiterOutreachActivation({ activation: "live", dryRun: false, liveActivationConfirmed: true, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, maxMessagesPerDay: 500, maxMessagesPerHour: 21 }).allowed).toBe(true);
  });
});
