import { RecruiterOutreachSendService } from "./RecruiterOutreachSendService";
import { RecruiterOutreachMessageRecord, RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";

const message: RecruiterOutreachMessageRecord = {
  id: "message-gmail-gate",
  sequenceId: "sequence-1",
  messageType: "INITIAL",
  sequenceStep: 0,
  recipientEmail: "recruiter@acme.dev",
  subject: "Frontend Engineer at Acme",
  body: "Hi,\n\nI’m Candidate.",
  status: "PREPARED"
};

function repository(): RecruiterDiscoveryRepository {
  return {
    getOutreachSequence: jest.fn().mockResolvedValue({ id: "sequence-1", recruiterContactId: "contact-1", jobOpportunityId: "job-1", applicationId: null, candidateProfileId: "candidate-1", status: "ACTIVE", nextActionAt: null, followUpCount: 0 }),
    isSuppressed: jest.fn().mockResolvedValue({ email: false, domain: false }),
    claimPreparedOutreachMessageWithinRateLimits: jest.fn().mockResolvedValue(message),
    countSentOutreachMessagesSince: jest.fn().mockResolvedValue(0),
    claimPreparedOutreachMessage: jest.fn().mockResolvedValue(message),
    markOutreachMessageSent: jest.fn().mockResolvedValue(undefined),
    markOutreachMessageFailed: jest.fn().mockResolvedValue(undefined)
  } as unknown as RecruiterDiscoveryRepository;
}

describe("RecruiterOutreachSendService Gmail kill switch", () => {
  const original = process.env.GMAIL_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.GMAIL_ENABLED;
    else process.env.GMAIL_ENABLED = original;
  });

  it("defaults Gmail sending to disabled when the environment variable is absent", async () => {
    delete process.env.GMAIL_ENABLED;
    const repo = repository();
    const mailbox = { sendMessage: jest.fn() };
    const service = new RecruiterOutreachSendService({
      repository: repo,
      mailbox: mailbox as never,
      dryRun: false,
      outboundEnabled: true,
      activation: "canary",
      maxMessagesPerDay: 1,
      maxMessagesPerHour: 1
    });

    await expect(service.send(message, "acme.dev")).resolves.toEqual({
      status: "SKIPPED",
      messageId: message.id,
      reason: "Gmail sending is disabled."
    });
    expect(mailbox.sendMessage).not.toHaveBeenCalled();
    expect(repo.claimPreparedOutreachMessageWithinRateLimits).not.toHaveBeenCalled();
  });

  it("blocks live recruiter delivery when GMAIL_ENABLED=false even if outbound is enabled", async () => {
    process.env.GMAIL_ENABLED = "false";
    const repo = repository();
    const mailbox = { sendMessage: jest.fn() };
    const service = new RecruiterOutreachSendService({
      repository: repo,
      mailbox: mailbox as never,
      dryRun: false,
      outboundEnabled: true,
      activation: "canary",
      maxMessagesPerDay: 1,
      maxMessagesPerHour: 1
    });

    await expect(service.send(message, "acme.dev")).resolves.toEqual({
      status: "SKIPPED",
      messageId: message.id,
      reason: "Gmail sending is disabled."
    });
    expect(mailbox.sendMessage).not.toHaveBeenCalled();
    expect(repo.claimPreparedOutreachMessageWithinRateLimits).not.toHaveBeenCalled();
  });
});
