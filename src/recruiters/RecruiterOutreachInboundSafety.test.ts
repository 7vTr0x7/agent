import { Database } from "../database/Database";
import { GmailMailbox } from "../email/GmailMailbox";
import { RecruiterDiscoveryRepository } from "./RecruiterDiscoveryRepository";
import { RecruiterOutreachSendReconciliationService } from "./RecruiterOutreachSendReconciliationService";

describe("RecruiterOutreachSendReconciliationService inbound follow-up safety", () => {
  const baseMessage = {
    gmailMessageId: "reply-1",
    gmailThreadId: "thread-1",
    rfcMessageId: "<reply@example.com>",
    inReplyTo: null,
    senderEmail: "recruiter@example.com",
    senderName: "Recruiter",
    recipientEmail: "me@example.com",
    subject: "Re: Frontend Engineer",
    receivedAt: new Date("2026-10-06T10:00:00Z"),
    snippet: "Thanks",
    bodyText: "Thanks for your email.",
    classification: "OTHER" as const
  };

  it("stops an active sequence when the recruiter replies", async () => {
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{
          sequenceId: "seq-1",
          recipientEmail: "recruiter@example.com",
          providerThreadId: "thread-1",
          providerMessageId: "sent-1",
          sentAt: new Date("2026-10-05T10:00:00Z")
        }] })
        .mockResolvedValueOnce({ rows: [] })
    } as unknown as Database;
    const repository = {
      stopOutreachSequence: jest.fn().mockResolvedValue(undefined),
      suppressRecruiterEmail: jest.fn().mockResolvedValue(undefined)
    } as unknown as RecruiterDiscoveryRepository;
    const mailbox = {
      listMessages: jest.fn().mockImplementation(async (query: string) => query.startsWith("thread:") ? ["reply-1"] : []),
      getMessage: jest.fn().mockResolvedValue(baseMessage)
    } as unknown as GmailMailbox;

    const service = new RecruiterOutreachSendReconciliationService(database, repository, mailbox);
    await service.runOnce();

    expect(repository.stopOutreachSequence).toHaveBeenCalledWith(
      "seq-1",
      "Recipient replied to recruiter outreach; follow-ups are no longer appropriate."
    );
    expect(repository.suppressRecruiterEmail).not.toHaveBeenCalled();
  });

  it("suppresses a mailbox when the reply says the recipient no longer works there", async () => {
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{
          sequenceId: "seq-1",
          recipientEmail: "evelien@conclusion.nl",
          providerThreadId: "thread-1",
          providerMessageId: "sent-1",
          sentAt: new Date("2026-10-05T10:00:00Z")
        }] })
        .mockResolvedValueOnce({ rows: [] })
    } as unknown as Database;
    const repository = {
      stopOutreachSequence: jest.fn().mockResolvedValue(undefined),
      suppressRecruiterEmail: jest.fn().mockResolvedValue(undefined)
    } as unknown as RecruiterDiscoveryRepository;
    const mailbox = {
      listMessages: jest.fn().mockImplementation(async (query: string) => query.startsWith("thread:") ? ["reply-1"] : []),
      getMessage: jest.fn().mockResolvedValue({
        ...baseMessage,
        senderEmail: "evelien@conclusion.nl",
        bodyText: "Beste,\n\nIk ben niet meer werkzaam voor Conclusion. Heb je een vraag, dan kun je jouw bericht sturen naar marcom@conclusion.nl.\n\nGroeten,\nEvelien"
      })
    } as unknown as GmailMailbox;

    const service = new RecruiterOutreachSendReconciliationService(database, repository, mailbox);
    await service.runOnce();

    expect(repository.stopOutreachSequence).toHaveBeenCalled();
    expect(repository.suppressRecruiterEmail).toHaveBeenCalledWith(
      "evelien@conclusion.nl",
      "Recipient replied that they are no longer employed by the company.",
      "gmail_inbound_departed_reply"
    );
  });

  it("suppresses an address reported by Gmail as not found", async () => {
    const database = {
      query: jest.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ recipientEmail: "missing@example.com" }] })
        .mockResolvedValueOnce({ rows: [] })
    } as unknown as Database;
    const repository = {
      suppressRecruiterEmail: jest.fn().mockResolvedValue(undefined)
    } as unknown as RecruiterDiscoveryRepository;
    const mailbox = {
      listMessages: jest.fn().mockImplementation(async (query: string) => query.includes("mailer-daemon") ? ["bounce-1"] : []),
      getMessage: jest.fn().mockResolvedValue({
        ...baseMessage,
        gmailMessageId: "bounce-1",
        senderEmail: "mailer-daemon@googlemail.com",
        recipientEmail: "me@example.com",
        subject: "Address not found",
        bodyText: "The email to missing@example.com could not be delivered because the address was not found."
      })
    } as unknown as GmailMailbox;

    const service = new RecruiterOutreachSendReconciliationService(database, repository, mailbox);
    await service.runOnce();

    expect(repository.suppressRecruiterEmail).toHaveBeenCalledWith(
      "missing@example.com",
      "Gmail reported that the recipient address could not be delivered.",
      "gmail_delivery_bounce"
    );
  });
});
