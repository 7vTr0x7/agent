import { RecruiterOutreachSendService } from "./RecruiterOutreachSendService";
import { RecruiterDiscoveryRepository, RecruiterOutreachMessageRecord } from "./RecruiterDiscoveryRepository";
import { GmailMailbox } from "../email/GmailMailbox";

const message: RecruiterOutreachMessageRecord = { id: "message-activation-1", sequenceId: "sequence-1", messageType: "INITIAL", sequenceStep: 0, recipientEmail: "recruiter@acme.dev", subject: "Application", body: "Hi", status: "PREPARED" };

function repository(): RecruiterDiscoveryRepository {
  return {
    getOutreachSequence: jest.fn().mockResolvedValue({ id: "sequence-1", recruiterContactId: "contact-1", jobOpportunityId: "job-1", applicationId: "application-1", candidateProfileId: "candidate-1", status: "ACTIVE", nextActionAt: null, followUpCount: 0 }),
    isSuppressed: jest.fn().mockResolvedValue({ email: false, domain: false }),
    countSentOutreachMessagesSince: jest.fn().mockResolvedValue(0),
    claimPreparedOutreachMessageWithinRateLimits: jest.fn().mockResolvedValue(message),
    claimPreparedOutreachMessage: jest.fn(),
    markOutreachMessageSent: jest.fn(),
    markOutreachMessageFailed: jest.fn()
  } as unknown as RecruiterDiscoveryRepository;
}

function mailbox(): GmailMailbox {
  return { listMessages: jest.fn(), getMessage: jest.fn(), sendMessage: jest.fn().mockResolvedValue({ gmailMessageId: "gmail-1", gmailThreadId: "thread-1" }) } as unknown as GmailMailbox;
}

describe("RecruiterOutreachSendService activation", () => {
  it("cannot send when activation remains disabled even with outbound enabled", async () => {
    const mail = mailbox();
    const repo = repository();
    const service = new RecruiterOutreachSendService({ repository: repo, mailbox: mail, gmailEnabled: true, dryRun: false, outboundEnabled: true, activation: "disabled", maxMessagesPerDay: 500, maxMessagesPerHour: 21 });
    await expect(service.send(message, "acme.dev")).resolves.toEqual({ status: "SKIPPED", messageId: message.id, reason: "Recruiter outreach activation is disabled." });
    expect(mail.sendMessage).not.toHaveBeenCalled();
    expect(repo.claimPreparedOutreachMessageWithinRateLimits).not.toHaveBeenCalled();
  });

  it("allows only a one-message canary configuration", async () => {
    const mail = mailbox();
    const repo = repository();
    const service = new RecruiterOutreachSendService({ repository: repo, mailbox: mail, gmailEnabled: true, dryRun: false, outboundEnabled: true, activation: "canary", maxMessagesPerDay: 1, maxMessagesPerHour: 1 });
    await expect(service.send(message, "acme.dev")).resolves.toMatchObject({ status: "SENT", messageId: message.id });
    expect(mail.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("cannot enter canary mode with the full Gmail ceiling", async () => {
    const mail = mailbox();
    const repo = repository();
    const service = new RecruiterOutreachSendService({ repository: repo, mailbox: mail, gmailEnabled: true, dryRun: false, outboundEnabled: true, activation: "canary", maxMessagesPerDay: 500, maxMessagesPerHour: 21 });
    await expect(service.send(message, "acme.dev")).resolves.toEqual({ status: "SKIPPED", messageId: message.id, reason: "Canary activation requires exactly 1 recruiter message per day and per hour." });
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });
});
