import { RecruiterDiscoveryRepository, PreparedRecruiterFollowUpMessage } from "./RecruiterDiscoveryRepository";
import { RecruiterOutreachFollowUpScheduler } from "./RecruiterOutreachFollowUpScheduler";
import { RecruiterOutreachSendTaskDispatcher } from "./RecruiterOutreachSendTask";

describe("RecruiterOutreachFollowUpScheduler", () => {
  it("prepares due follow-ups and queues each message", async () => {
    const messages: PreparedRecruiterFollowUpMessage[] = [
      {
        id: "message-1",
        sequenceId: "sequence-1",
        messageType: "FOLLOW_UP",
        sequenceStep: 1,
        recipientEmail: "recruiter@acme.dev",
        subject: "Application follow-up",
        body: "Follow-up",
        status: "PREPARED",
        companyDomain: "acme.dev"
      },
      {
        id: "message-2",
        sequenceId: "sequence-2",
        messageType: "FOLLOW_UP",
        sequenceStep: 2,
        recipientEmail: "talent@beta.dev",
        subject: "Application follow-up",
        body: "Follow-up",
        status: "PREPARED",
        companyDomain: "beta.dev"
      }
    ];

    const repository = {
      prepareDueRecruiterFollowUps: jest.fn().mockResolvedValue(messages)
    } as unknown as RecruiterDiscoveryRepository;
    const sendDispatcher = {
      enqueue: jest.fn().mockResolvedValue("task-id")
    } as unknown as RecruiterOutreachSendTaskDispatcher;

    const scheduler = new RecruiterOutreachFollowUpScheduler(repository, sendDispatcher, true, 10);

    await expect(scheduler.runOnce()).resolves.toEqual({ prepared: 2, queued: 2 });
    expect(repository.prepareDueRecruiterFollowUps).toHaveBeenCalledWith(10);
    expect(sendDispatcher.enqueue).toHaveBeenNthCalledWith(1, {
      messageId: "message-1",
      companyDomain: "acme.dev"
    });
    expect(sendDispatcher.enqueue).toHaveBeenNthCalledWith(2, {
      messageId: "message-2",
      companyDomain: "beta.dev"
    });
  });

  it("does nothing when follow-ups are disabled", async () => {
    const repository = {
      prepareDueRecruiterFollowUps: jest.fn()
    } as unknown as RecruiterDiscoveryRepository;
    const sendDispatcher = {
      enqueue: jest.fn()
    } as unknown as RecruiterOutreachSendTaskDispatcher;

    const scheduler = new RecruiterOutreachFollowUpScheduler(repository, sendDispatcher, false);

    await expect(scheduler.runOnce()).resolves.toEqual({ prepared: 0, queued: 0 });
    expect(repository.prepareDueRecruiterFollowUps).not.toHaveBeenCalled();
    expect(sendDispatcher.enqueue).not.toHaveBeenCalled();
  });
});
