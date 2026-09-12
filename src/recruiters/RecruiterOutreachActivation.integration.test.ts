import { evaluateRecruiterOutreachActivation, CONTROLLED_SEND_CONFIRMATION } from "./RecruiterOutreachActivationGate";

describe("Recruiter outreach activation boundary", () => {
  it("keeps default-style disabled activation closed", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "disabled", dryRun: false, liveActivationConfirmed: false, maxMessagesPerDay: 500, maxMessagesPerHour: 21 })).toEqual({ allowed: false, reason: "Recruiter outreach activation is disabled." });
  });

  it("blocks canary without explicit confirmation", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "canary", dryRun: false, liveActivationConfirmed: false, maxMessagesPerDay: 1, maxMessagesPerHour: 1 })).toEqual({ allowed: false, reason: `Real recruiter delivery requires explicit controlled confirmation ${CONTROLLED_SEND_CONFIRMATION}.` });
  });

  it("requires a selected message and recipient for a one-message canary", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "canary", dryRun: false, liveActivationConfirmed: false, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, maxMessagesPerDay: 1, maxMessagesPerHour: 1 })).toEqual({ allowed: false, reason: "Canary activation requires an explicit controlled message ID and recipient." });
    expect(evaluateRecruiterOutreachActivation({ activation: "canary", dryRun: false, liveActivationConfirmed: false, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, controlledMessageId: "message-1", controlledRecipient: "recruiter@example.test", maxMessagesPerDay: 1, maxMessagesPerHour: 1 }).allowed).toBe(true);
    expect(evaluateRecruiterOutreachActivation({ activation: "canary", dryRun: false, liveActivationConfirmed: false, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, controlledMessageId: "message-1", controlledRecipient: "recruiter@example.test", maxMessagesPerDay: 2, maxMessagesPerHour: 1 })).toEqual({ allowed: false, reason: "Canary activation requires exactly 1 recruiter message per day and per hour." });
  });

  it("requires explicit confirmation and live confirmation for live activation", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "live", dryRun: false, liveActivationConfirmed: false, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, maxMessagesPerDay: 500, maxMessagesPerHour: 21 })).toEqual({ allowed: false, reason: "Live recruiter outreach requires RECRUITER_LIVE_ACTIVATION_CONFIRMED=true." });
    expect(evaluateRecruiterOutreachActivation({ activation: "live", dryRun: false, liveActivationConfirmed: true, maxMessagesPerDay: 500, maxMessagesPerHour: 21 })).toEqual({ allowed: false, reason: `Real recruiter delivery requires explicit controlled confirmation ${CONTROLLED_SEND_CONFIRMATION}.` });
    expect(evaluateRecruiterOutreachActivation({ activation: "live", dryRun: false, liveActivationConfirmed: true, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, maxMessagesPerDay: 500, maxMessagesPerHour: 21 }).allowed).toBe(true);
  });

  it("never permits dry-run to become a real send", () => {
    expect(evaluateRecruiterOutreachActivation({ activation: "canary", dryRun: true, liveActivationConfirmed: true, controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, maxMessagesPerDay: 1, maxMessagesPerHour: 1 }).allowed).toBe(true);
  });
});
