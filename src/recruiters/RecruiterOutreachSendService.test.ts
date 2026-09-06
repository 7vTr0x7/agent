import { GmailMailbox } from "../email/GmailMailbox";
import { RecruiterDiscoveryRepository, RecruiterOutreachMessageRecord } from "./RecruiterDiscoveryRepository";
import { RecruiterOutreachSendService } from "./RecruiterOutreachSendService";

const message: RecruiterOutreachMessageRecord = {
  id: "message-1", sequenceId: "sequence-1", messageType: "INITIAL", sequenceStep: 0,
  recipientEmail: "recruiter@acme.dev", subject: "Application for Frontend Engineer at Acme",
  body: "Hi,\n\nI’m Candidate.", status: "PREPARED"
};

function repository(overrides: Partial<RecruiterDiscoveryRepository> = {}): RecruiterDiscoveryRepository {
  return {
    isSuppressed: jest.fn().mockResolvedValue({ email: false, domain: false }),
    countSentOutreachMessagesSince: jest.fn().mockResolvedValue(0),
    claimPreparedOutreachMessage: jest.fn().mockResolvedValue(message),
    markOutreachMessageSent: jest.fn().mockResolvedValue(undefined),
    markOutreachMessageFailed: jest.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as RecruiterDiscoveryRepository;
}

function mailbox(overrides: Partial<GmailMailbox> = {}): GmailMailbox {
  return {
    listMessages: jest.fn(),
    getMessage: jest.fn(),
    sendMessage: jest.fn().mockResolvedValue({ gmailMessageId: "gmail-1", gmailThreadId: "thread-1" }),
    ...overrides
  } as unknown as GmailMailbox;
}

describe("RecruiterOutreachSendService", () => {
  it("never sends in dry-run mode", async () => {
    const mail = mailbox();
    const service = new RecruiterOutreachSendService({ repository: repository(), mailbox: mail, dryRun: true });

    await expect(service.send(message, "acme.dev")).resolves.toEqual({ status: "DRY_RUN", messageId: message.id });
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks suppressed recipients before claiming or sending", async () => {
    const repo = repository({ isSuppressed: jest.fn().mockResolvedValue({ email: true, domain: false }) });
    const mail = mailbox();
    const service = new RecruiterOutreachSendService({ repository: repo, mailbox: mail, dryRun: false });

    await expect(service.send(message, "acme.dev")).resolves.toMatchObject({ status: "SKIPPED" });
    expect(repo.claimPreparedOutreachMessage).not.toHaveBeenCalled();
    expect(mail.sendMessage).not.toHaveBeenCalled();
  });

  it("enforces the hourly limit before claiming", async () => {
    const repo = repository({ countSentOutreachMessagesSince: jest.fn().mockResolvedValue(5) });
    const service = new RecruiterOutreachSendService({ repository: repo, mailbox: mailbox(), dryRun: false, maxMessagesPerHour: 5, maxMessagesPerDay: 20 });

    const result = await service.send(message, "acme.dev");
    expect(result).toMatchObject({ status: "SKIPPED" });
    expect(repo.claimPreparedOutreachMessage).not.toHaveBeenCalled();
  });

  it("claims, sends, and records the provider identifiers", async () => {
    const repo = repository();
    const mail = mailbox();
    const service = new RecruiterOutreachSendService({ repository: repo, mailbox: mail, dryRun: false, maxMessagesPerHour: 5, maxMessagesPerDay: 20 });

    await expect(service.send(message, "acme.dev")).resolves.toEqual({
      status: "SENT", messageId: message.id, gmailMessageId: "gmail-1", gmailThreadId: "thread-1"
    });
    expect(mail.sendMessage).toHaveBeenCalledWith({ to: message.recipientEmail, subject: message.subject, bodyText: message.body });
    expect(repo.markOutreachMessageSent).toHaveBeenCalledWith(message.id, {
      provider: "gmail", providerMessageId: "gmail-1", providerThreadId: "thread-1"
    });
  });

  it("marks a claimed message failed when Gmail rejects the send", async () => {
    const error = new Error("Gmail unavailable");
    const repo = repository();
    const mail = mailbox({ sendMessage: jest.fn().mockRejectedValue(error) });
    const service = new RecruiterOutreachSendService({ repository: repo, mailbox: mail, dryRun: false });

    await expect(service.send(message, "acme.dev")).rejects.toThrow("Gmail unavailable");
    expect(repo.markOutreachMessageFailed).toHaveBeenCalledWith(message.id, "Gmail unavailable");
  });
});
