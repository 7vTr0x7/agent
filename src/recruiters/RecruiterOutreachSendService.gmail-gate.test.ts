import { RecruiterOutreachSendService } from "./RecruiterOutreachSendService";
import { RecruiterOutreachMessageRecord, RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { CONTROLLED_SEND_CONFIRMATION } from "./RecruiterOutreachActivationGate";

const message: RecruiterOutreachMessageRecord = { id: "message-gmail-gate", sequenceId: "sequence-1", messageType: "INITIAL", sequenceStep: 0, recipientEmail: "recruiter@acme.dev", subject: "Frontend Engineer at Acme", body: "Hi,\n\nI’m Candidate.", status: "PREPARED" };
function repository(): RecruiterDiscoveryRepository { return { getOutreachSequence: jest.fn().mockResolvedValue({ id: "sequence-1", recruiterContactId: "contact-1", jobOpportunityId: "job-1", applicationId: null, candidateProfileId: "candidate-1", status: "ACTIVE", nextActionAt: null, followUpCount: 0 }), isSuppressed: jest.fn().mockResolvedValue({ email: false, domain: false }), claimPreparedOutreachMessageWithinRateLimits: jest.fn().mockResolvedValue(message), countSentOutreachMessagesSince: jest.fn().mockResolvedValue(0), claimPreparedOutreachMessage: jest.fn().mockResolvedValue(message), markOutreachMessageSent: jest.fn().mockResolvedValue(undefined), markOutreachMessageFailed: jest.fn().mockResolvedValue(undefined) } as unknown as RecruiterDiscoveryRepository; }

describe("RecruiterOutreachSendService Gmail kill switch", () => {
  it("reaches the Gmail kill switch only after explicit Phase 6 confirmation", async () => {
    const mail = { sendMessage: jest.fn() };
    const service = new RecruiterOutreachSendService({ repository: repository(), mailbox: mail as never, dryRun: false, outboundEnabled: true, gmailEnabled: false, activation: "canary", controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, maxMessagesPerDay: 1, maxMessagesPerHour: 1 });
    await expect(service.send(message, "acme.dev")).resolves.toEqual({ status: "SKIPPED", messageId: message.id, reason: "Gmail sending is disabled." });
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks Gmail-disabled delivery even when outbound and explicit confirmation are enabled", async () => {
    const mail = { sendMessage: jest.fn() };
    const service = new RecruiterOutreachSendService({ repository: repository(), mailbox: mail as never, dryRun: false, outboundEnabled: true, gmailEnabled: false, activation: "canary", controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, maxMessagesPerDay: 1, maxMessagesPerHour: 1 });
    await expect(service.send(message, "acme.dev")).resolves.toMatchObject({ status: "SKIPPED", reason: "Gmail sending is disabled." });
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks Gmail-enabled delivery when explicit confirmation is absent", async () => {
    const mail = { sendMessage: jest.fn() };
    const service = new RecruiterOutreachSendService({ repository: repository(), mailbox: mail as never, dryRun: false, outboundEnabled: true, gmailEnabled: true, activation: "canary", maxMessagesPerDay: 1, maxMessagesPerHour: 1 });
    await expect(service.send(message, "acme.dev")).resolves.toEqual({ status: "SKIPPED", messageId: message.id, reason: `Real recruiter delivery requires explicit controlled confirmation ${CONTROLLED_SEND_CONFIRMATION}.` });
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });
});
