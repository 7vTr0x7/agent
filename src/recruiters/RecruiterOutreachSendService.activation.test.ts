import { evaluateRecruiterOutreachActivation, CONTROLLED_SEND_CONFIRMATION } from "./RecruiterOutreachActivationGate";

describe("RecruiterOutreachSendService activation", () => {
  it("blocks canary without explicit confirmation", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "canary", dryRun: false, liveActivationConfirmed: false, maxMessagesPerDay: 1, maxMessagesPerHour: 1 })).toEqual({ allowed: false, reason: `Real recruiter delivery requires explicit controlled confirmation ${CONTROLLED_SEND_CONFIRMATION}.` });
  });
  it("allows exact canary envelope with explicit confirmation", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "canary", dryRun: false, liveActivationConfirmed: false, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, maxMessagesPerDay: 1, maxMessagesPerHour: 1 }).allowed).toBe(true);
  });
  it("still rejects an oversized canary", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "canary", dryRun: false, liveActivationConfirmed: false, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, maxMessagesPerDay: 500, maxMessagesPerHour: 21 })).toEqual({ allowed: false, reason: "Canary activation requires exactly 1 recruiter message per day and per hour." });
  });
});
