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
      associateAndUpdateApplication: jest.fn().mockResolvedValue(null)
    };
    const classifier = { classify: jest.fn().mockReturnValue("RECRUITER") };
    const inbound = {
      process: jest.fn()
        .mockRejectedValueOnce(new Error("temporary failure"))
        .mockResolvedValueOnce({ status: "IGNORED" })
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
    expect(messages.save).toHaveBeenCalledTimes(2);
  });
});
