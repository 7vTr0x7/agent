import { GmailSyncTaskHandler, SYNC_GMAIL_TASK } from "./GmailSyncTask";

describe("GmailSyncTaskHandler failure isolation", () => {
  it("continues processing later messages when one message fails", async () => {
    const mailbox = {
      listMessages: jest.fn().mockResolvedValue(["bad-message", "good-message"]),
      getMessage: jest.fn()
        .mockRejectedValueOnce(new Error("message unavailable"))
        .mockResolvedValueOnce({
          gmailMessageId: "good-message",
          gmailThreadId: "thread-1",
          senderEmail: "recruiter@example.com",
          senderName: "Recruiter",
          recipientEmail: "candidate@example.com",
          subject: "Interview",
          bodyText: "Let's schedule an interview.",
          receivedAt: new Date()
        })
    };
    const messages = {
      save: jest.fn().mockResolvedValue(undefined),
      associateAndUpdateApplication: jest.fn().mockResolvedValue(null)
    };
    const classifier = { classify: jest.fn().mockReturnValue("OTHER") };

    await new GmailSyncTaskHandler(
      mailbox as never,
      messages as never,
      undefined,
      classifier as never
    ).handle({ taskType: SYNC_GMAIL_TASK, payload: { query: "in:inbox", maxResults: 2 } });

    expect(mailbox.getMessage).toHaveBeenCalledTimes(2);
    expect(messages.save).toHaveBeenCalledTimes(1);
  });

  it("isolates recruiter inbound processing failures and continues the message lifecycle", async () => {
    const mailbox = {
      listMessages: jest.fn().mockResolvedValue(["message-1", "message-2"]),
      getMessage: jest.fn().mockImplementation(async (id: string) => ({
        gmailMessageId: id,
        gmailThreadId: `thread-${id}`,
        senderEmail: "recruiter@example.com",
        senderName: "Recruiter",
        recipientEmail: "candidate@example.com",
        subject: "Recruiter reply",
        bodyText: "Thanks for applying.",
        receivedAt: new Date()
      }))
    };
    const messages = {
      save: jest.fn().mockResolvedValue(undefined),
      associateAndUpdateApplication: jest.fn().mockResolvedValue(null)
    };
    const classifier = { classify: jest.fn().mockReturnValue("RECRUITER") };
    const recruiterInboundProcessor = {
      process: jest.fn()
        .mockRejectedValueOnce(new Error("processor unavailable"))
        .mockResolvedValueOnce({ status: "IGNORED" })
    };

    await new GmailSyncTaskHandler(
      mailbox as never,
      messages as never,
      undefined,
      classifier as never,
      undefined,
      recruiterInboundProcessor as never
    ).handle({ taskType: SYNC_GMAIL_TASK, payload: { query: "in:inbox", maxResults: 2 } });

    expect(recruiterInboundProcessor.process).toHaveBeenCalledTimes(2);
    expect(messages.save).toHaveBeenCalledTimes(2);
  });
});
