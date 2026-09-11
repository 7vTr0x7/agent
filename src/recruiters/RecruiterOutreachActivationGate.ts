export type RecruiterOutreachActivation = "disabled" | "canary" | "live";

export interface RecruiterOutreachActivationInput {
  activation: RecruiterOutreachActivation;
  dryRun: boolean;
  liveActivationConfirmed: boolean;
  controlledSendConfirmation?: string;
  maxMessagesPerDay: number;
  maxMessagesPerHour: number;
}

export interface RecruiterOutreachActivationResult {
  allowed: boolean;
  reason: string;
}

export const CONTROLLED_SEND_CONFIRMATION = "SEND_ONE_REAL_EMAIL";

/** Explicit runtime activation boundary. Real delivery requires the separate controlled-send confirmation. */
export function evaluateRecruiterOutreachActivation(input: RecruiterOutreachActivationInput): RecruiterOutreachActivationResult {
  if (input.dryRun) return { allowed: true, reason: "Dry-run mode is active; real delivery is disabled." };
  if (input.activation === "disabled") return { allowed: false, reason: "Recruiter outreach activation is disabled." };
  if (input.controlledSendConfirmation !== CONTROLLED_SEND_CONFIRMATION) {
    return { allowed: false, reason: `Real recruiter delivery requires explicit controlled confirmation ${CONTROLLED_SEND_CONFIRMATION}.` };
  }
  if (input.activation === "canary") {
    if (input.maxMessagesPerDay !== 1 || input.maxMessagesPerHour !== 1) {
      return { allowed: false, reason: "Canary activation requires exactly 1 recruiter message per day and per hour." };
    }
    return { allowed: true, reason: "One-message recruiter outreach canary is explicitly enabled." };
  }
  if (!input.liveActivationConfirmed) {
    return { allowed: false, reason: "Live recruiter outreach requires RECRUITER_LIVE_ACTIVATION_CONFIRMED=true." };
  }
  return { allowed: true, reason: "Live recruiter outreach activation is explicitly confirmed." };
}
