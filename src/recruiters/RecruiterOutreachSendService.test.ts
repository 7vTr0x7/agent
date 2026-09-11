import { GmailMailbox } from "../email/GmailMailbox";
import { RecruiterDiscoveryRepository, RecruiterOutreachMessageRecord } from "./RecruiterDiscoveryRepository";
import { CONTROLLED_SEND_CONFIRMATION } from "./RecruiterOutreachActivationGate";
import { RecruiterOutreachSendService, deterministicMessageId } from "./RecruiterOutreachSendService";

const message: RecruiterOutreachMessageRecord = {
  id: "message-1", sequenceId: "sequence-1", messageType: "INITIAL", sequenceStep: 0,
  recipientEmail: "recruiter@acme.dev", subject: "Application for Frontend Engineer at Acme",
  body: "Hi,\n\nI’m Candidate.", status: "PREPARED"
};

function repository(overrides: Partial<RecruiterDiscoveryRepository> = {}): RecruiterDiscoveryRepository {
  return {
    getOutreachSequence: jest.fn().mockResolvedValue({ id: "sequence-1", recruiterContactId: "contact-1", jobOpportunityId: "job-1", applicationId: null, candidateProfileId: "candidate-1", status: "ACTIVE", nextActionAt: null, followUpCount: 0 }),
    isSuppressed: jest.fn().mockResolvedValue({ email: false, domain: false }),
    getOutreachMessage: jest.fn().mockResolvedValue(message),
    countSentOutreachMessagesSince: jest.fn().mockResolvedValue(0),
    claimPreparedOutreachMessage: jest.fn().mockResolvedValue(message),
    claimPreparedOutreachMessageWithinRateLimits: jest.fn().mockResolvedValue(message),
    markOutreachMessageSent: jest.fn().mockResolvedValue(undefined),
    markOutreachMessageFailed: jest.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as RecruiterDiscoveryRepository;
}

function mailbox(overrides: Partial<GmailMailbox> = {}): GmailMailbox {
  return { listMessages: jest.fn(), getMessage: jest.fn(), sendMessage: jest.fn().mockResolvedValue({ gmailMessageId: "gmail-1", gmailThreadId: "thread-1" }), ...overrides } as unknown as GmailMailbox;
}

function database(overrides: Record<string, jest.Mock> = {}): any {
  const client = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: message.id, sequence_id: message.sequenceId, message_type: "INITIAL", sequence_step: 0,
      recipient_email: message.recipientEmail, subject: message.subject, body: message.body, status: "PREPARED",
      recruiter_contact_id: "contact-1", job_opportunity_id: "job-1", candidate_profile_id: "candidate-1",
      company_domain: "acme.dev", contact_email: message.recipientEmail, recruiter_verified: true,
      recruiter_verification_status: "verified_mailbox", send_state: "READY", existing_client_message_id: null
    }] })
    .mockResolvedValueOnce({ rows: [{ suppressed: false }] })
    .mockResolvedValueOnce({ rows: [{ day_count: "0", hour_count: "0" }] })
    .mockResolvedValueOnce({ rows: [{ id: message.id, sequence_id: message.sequenceId, message_type: "INITIAL", sequence_step: 0, recipient_email: message.recipientEmail, subject: message.subject, body: message.body, status: "SENDING" }] }) };
  return { transaction: jest.fn().mockImplementation(async (callback: (c: any) => Promise<unknown>) => callback(client)), query: jest.fn().mockResolvedValue({ rows: [] }), ...overrides };
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
    const service = new RecruiterOutreachSendService({ repository: repo, mailbox: mailbox(), dryRun: false, outboundEnabled: true, gmailEnabled: true, activation: "canary", controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, maxMessagesPerDay: 1, maxMessagesPerHour: 1 });
    await expect(service.send(message, "acme.dev")).resolves.toMatchObject({ status: "SKIPPED", reason: "Recipient is suppressed." });
  });

  it("requires the controlled message and recipient in live mode", async () => {
    const service = new RecruiterOutreachSendService({ repository: repository(), mailbox: mailbox(), database: database(), dryRun: false, outboundEnabled: true, gmailEnabled: true, activation: "canary", controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, controlledMessageId: "different", controlledRecipient: message.recipientEmail, maxMessagesPerDay: 1, maxMessagesPerHour: 1 });
    await expect(service.send(message, "acme.dev")).resolves.toMatchObject({ status: "SKIPPED" });
  });

  it("requires mailbox verification for real delivery", async () => {
    const db = database();
    const client = db.transaction.mock.results;
    void client;
    const repo = repository();
    const realDb = database();
    const original = realDb.transaction;
    realDb.transaction = jest.fn().mockImplementation(async (callback: (c: any) => Promise<unknown>) => {
      const c = { query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...message, sequence_id: message.sequenceId, recruiter_contact_id: "contact-1", job_opportunity_id: "job-1", candidate_profile_id: "candidate-1", company_domain: "acme.dev", contact_email: message.recipientEmail, recruiter_verified: false, send_state: "READY" }] }) };
      return callback(c);
    });
    const service = new RecruiterOutreachSendService({ repository: repo, mailbox: mailbox(), database: realDb, dryRun: false, outboundEnabled: true, gmailEnabled: true, activation: "canary", controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, controlledMessageId: message.id, controlledRecipient: message.recipientEmail, maxMessagesPerDay: 1, maxMessagesPerHour: 1 });
    await expect(service.send(message, "acme.dev")).resolves.toMatchObject({ status: "SKIPPED" });
    realDb.transaction = original;
  });

  it("atomically claims, sends once, and persists deterministic provider identifiers", async () => {
    const repo = repository();
    const mail = mailbox();
    const db = database();
    const service = new RecruiterOutreachSendService({ repository: repo, mailbox: mail, database: db, dryRun: false, outboundEnabled: true, gmailEnabled: true, automationEnabled: false, activation: "canary", controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, controlledMessageId: message.id, controlledRecipient: message.recipientEmail, requireVerifiedEmail: true, maxMessagesPerDay: 1, maxMessagesPerHour: 1, attachResume: false });
    await expect(service.send(message, "acme.dev")).resolves.toEqual({ status: "SENT", messageId: message.id, gmailMessageId: "gmail-1", gmailThreadId: "thread-1" });
    expect(mail.sendMessage).toHaveBeenCalledWith({ to: message.recipientEmail, subject: message.subject, bodyText: message.body, messageId: deterministicMessageId(message.id), attachments: undefined });
    expect(repo.markOutreachMessageSent).toHaveBeenCalledWith(message.id, { provider: "gmail", providerMessageId: "gmail-1", providerThreadId: "thread-1" });
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("send_state='SENT'"), [message.id]);
  });

  it("keeps an uncertain Gmail result ambiguous instead of marking it FAILED", async () => {
    const repo = repository();
    const mail = mailbox({ sendMessage: jest.fn().mockRejectedValue(new Error("network timeout after request acceptance")) });
    const db = database();
    const service = new RecruiterOutreachSendService({ repository: repo, mailbox: mail, database: db, dryRun: false, outboundEnabled: true, gmailEnabled: true, activation: "canary", controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, controlledMessageId: message.id, controlledRecipient: message.recipientEmail, maxMessagesPerDay: 1, maxMessagesPerHour: 1 });
    await expect(service.send(message, "acme.dev")).rejects.toThrow("network timeout after request acceptance");
    expect(repo.markOutreachMessageFailed).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("send_state='AMBIGUOUS'"), [message.id, "network timeout after request acceptance"]);
  });

  it("refuses broad automation during Phase 6 controlled activation", async () => {
    const service = new RecruiterOutreachSendService({ repository: repository(), mailbox: mailbox(), database: database(), dryRun: false, outboundEnabled: true, gmailEnabled: true, automationEnabled: true, activation: "canary", controlledSendConfirmation: CONTROLLED_SEND_CONFIRMATION, controlledMessageId: message.id, controlledRecipient: message.recipientEmail, maxMessagesPerDay: 1, maxMessagesPerHour: 1 });
    await expect(service.send(message, "acme.dev")).resolves.toMatchObject({ status: "SKIPPED", reason: "Phase 6 controlled activation refuses broad automation; AUTOMATION_ENABLED must remain false." });
  });
});
