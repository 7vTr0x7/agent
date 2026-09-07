import { RecruiterOutreachSendTaskHandler } from "./RecruiterOutreachSendTaskHandler";
import { SEND_RECRUITER_EMAIL_TASK } from "./RecruiterOutreachSendTask";

describe("RecruiterOutreachSendTaskHandler", () => {
  it("does not fail a successful send when follow-up scheduling fails", async () => {
    const message = {
      id: "message-1",
      sequenceId: "sequence-1",
      messageType: "INITIAL",
      sequenceStep: 0,
      recipientEmail: "recruiter@company.com",
      subject: "Application",
      body: "Hello",
      status: "PREPARED"
    } as const;
    const repository = {
      getOutreachMessage: jest.fn().mockResolvedValue(message)
    };
    const sendService = {
      send: jest.fn().mockResolvedValue({
        status: "SENT",
        messageId: message.id,
        gmailMessageId: "gmail-1",
        gmailThreadId: "thread-1"
      })
    };
    const followUpService = {
      scheduleNext: jest.fn().mockRejectedValue(new Error("database unavailable"))
    };
    const logger = { info: jest.fn(), error: jest.fn() };

    await expect(
      new RecruiterOutreachSendTaskHandler(
        sendService as never,
        repository as never,
        logger,
        followUpService as never
      ).handle({
        taskType: SEND_RECRUITER_EMAIL_TASK,
        payload: { messageId: message.id, companyDomain: "company.com" }
      } as never)
    ).resolves.toBeUndefined();

    expect(sendService.send).toHaveBeenCalledTimes(1);
    expect(followUpService.scheduleNext).toHaveBeenCalledWith("sequence-1");
    expect(logger.error).toHaveBeenCalledWith(
      "[recruiter-outreach] follow-up scheduling failed for sequence sequence-1: database unavailable"
    );
  });
});
