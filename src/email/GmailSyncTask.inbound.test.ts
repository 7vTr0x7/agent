import { GmailSyncTaskHandler, SYNC_GMAIL_TASK } from "./GmailSyncTask";

describe("GmailSyncTaskHandler recruiter inbound integration", () => {
  it("does not let an inbound processor failure block subsequent Gmail messages", async () => {
    const mailbox = {
      listMessages: jest.fn().mockResolvedValue(["message-1", "message-2"]),
      getMessage: jest.fn().mockImplementation(async (id: string) => ({
        gmailMessageId: id,
        gmailThreadId: `thread-${id}`,
        senderEmail: "recruiter@example.com",
        senderName: "Recruiter",
        recipientEmail: "candidate@example.com",
        subject: "Recruiter reply",
        bodyText: "Thanks for reaching out.",
        receivedAt: new Date()
      }))
    };
    const messages = {
      save: jest.fn().mockResolvedValue(undefined),
      associateAndUpdateApplication: jest.fn().mockResolvedValue(null),
      claimRecruiterInbound: jest.fn().mockResolvedValue(true),
      markRecruiterInboundProcessed: jest.fn().mockResolvedValue(undefined)
    };
    const classifier = { classify: jest.fn().mockReturnValue("RECRUITER") };
    const inbound = {
      process: jest.fn()
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValueOnce({ status: "REPLY_STOPPED" })
    };

    await new GmailSyncTaskHandler(
      mailbox as never,
      messages as never,
      undefined,
      classifier as never,
      undefined,
      inbound as never
    ).handle({ taskType: SYNC_GMAIL_TASK, payload: { query: "in:inbox", maxResults: 2 } });

    expect(inbound.process).toHaveBeenCalledTimes(2);
    expect(messages.claimRecruiterInbound).toHaveBeenCalledTimes(2);
    expect(messages.markRecruiterInboundProcessed).toHaveBeenCalledTimes(1);
    expect(messages.save).toHaveBeenCalledTimes(2);
  });

  it("does not process the same Gmail message twice when the durable inbound claim is already consumed", async () => {
    const message = {
      gmailMessageId: "message-1",
      gmailThreadId: "thread-1",
      senderEmail: "recruiter@example.com",
      senderName: "Recruiter",
      recipientEmail: "candidate@example.com",
      subject: "Recruiter reply",
      bodyText: "Thanks for reaching out.",
      receivedAt: new Date()
    };
    const mailbox = {
      listMessages: jest.fn().mockResolvedValue(["message-1", "message-1"]),
      getMessage: jest.fn().mockResolvedValue(message)
    };
    const messages = {
      save: jest.fn().mockResolvedValue(undefined),
      associateAndUpdateApplication: jest.fn().mockResolvedValue(null),
      claimRecruiterInbound: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      markRecruiterInboundProcessed: jest.fn().mockResolvedValue(undefined)
    };
    const classifier = { classify: jest.fn().mockReturnValue("RECRUITER") };
    const inbound = { process: jest.fn().mockResolvedValue({ status: "REPLY_STOPPED" }) };

    await new GmailSyncTaskHandler(
      mailbox as never,
      messages as never,
      undefined,
      classifier as never,
      undefined,
      inbound as never
    ).handle({ taskType: SYNC_GMAIL_TASK, payload: { query: "in:inbox", maxResults: 2 } });

    expect(inbound.process).toHaveBeenCalledTimes(1);
    expect(messages.markRecruiterInboundProcessed).toHaveBeenCalledTimes(1);
  });
});
