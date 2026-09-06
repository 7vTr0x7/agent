import { RecruiterOutreachPreparationService } from "./RecruiterOutreachPreparationService";
import { RecruiterOutreachPreparationTaskHandler } from "./RecruiterOutreachPreparationTaskHandler";
import { RecruiterOutreachSendService } from "./RecruiterOutreachSendService";
import { RecruiterOutreachSendTaskHandler } from "./RecruiterOutreachSendTaskHandler";
import { SEND_RECRUITER_EMAIL_TASK } from "./RecruiterOutreachSendTask";
import { RecruiterOutreachMessageRecord, StoredRecruiterContact } from "./RecruiterDiscoveryRepository";

function contact(): StoredRecruiterContact {
  return {
    id: "contact-1",
    companyName: "Acme Co",
    companyDomain: "acme.dev",
    email: "alex@acme.dev",
    fullName: "Alex Recruiter",
    title: "Technical Recruiter",
    department: "Talent Acquisition",
    confidence: 95,
    verified: true,
    verificationStatus: "valid",
    provider: "hunter"
  };
}

function task(payload: Record<string, unknown>): any {
  return { taskType: "PREPARE_RECRUITER_OUTREACH", payload };
}

describe("Recruiter outreach pipeline", () => {
  it("prepares a message, queues a send task, and dry-runs without calling Gmail", async () => {
    const preparedMessage: RecruiterOutreachMessageRecord = {
      id: "message-1",
      sequenceId: "sequence-1",
      messageType: "INITIAL",
      sequenceStep: 0,
      recipientEmail: "alex@acme.dev",
      subject: "Application for Frontend Engineer at Acme Co",
      body: "I’m Salman Shaikh, and I’ve applied for the Frontend Engineer role at Acme Co.",
      status: "PREPARED"
    };

    const repository = {
      isSuppressed: jest.fn().mockResolvedValue({ email: false, domain: false }),
      isOutreachSequenceDuplicate: jest.fn().mockResolvedValue(false),
      createOutreachSequence: jest.fn().mockResolvedValue({
        id: "sequence-1",
        recruiterContactId: "contact-1",
        jobOpportunityId: "job-1",
        applicationId: "application-1",
        candidateProfileId: "candidate-1",
        status: "READY",
        nextActionAt: null
      }),
      createOutreachMessage: jest.fn().mockResolvedValue(preparedMessage),
      getOutreachMessage: jest.fn().mockResolvedValue(preparedMessage),
      countSentOutreachMessagesSince: jest.fn().mockResolvedValue(0),
      claimPreparedOutreachMessage: jest.fn().mockResolvedValue(preparedMessage),
      markOutreachMessageSent: jest.fn(),
      markOutreachMessageFailed: jest.fn()
    };

    const queued: Array<{ messageId: string; companyDomain: string }> = [];
    const sendDispatcher = {
      enqueue: jest.fn().mockImplementation(async (payload) => {
        queued.push(payload);
        return "send-task-1";
      })
    };

    const preparation = new RecruiterOutreachPreparationService({
      repository: repository as never,
      dryRun: true
    });
    const preparationHandler = new RecruiterOutreachPreparationTaskHandler(
      preparation,
      sendDispatcher as never
    );

    await preparationHandler.handle(task({
      companyName: "Acme Co",
      companyDomain: "acme.dev",
      jobTitle: "Frontend Engineer",
      jobDescription: "Build React applications.",
      jobOpportunityId: "job-1",
      applicationId: "application-1",
      candidateProfileId: "candidate-1",
      candidateName: "Salman Shaikh",
      contacts: [contact()]
    }));

    expect(sendDispatcher.enqueue).toHaveBeenCalledTimes(1);
    expect(queued).toEqual([{ messageId: "message-1", companyDomain: "acme.dev" }]);

    const mailbox = { sendMessage: jest.fn() };
    const sendService = new RecruiterOutreachSendService({
      repository: repository as never,
      mailbox: mailbox as never,
      dryRun: true
    });
    const sendHandler = new RecruiterOutreachSendTaskHandler(sendService, repository as never);

    await sendHandler.handle({ taskType: SEND_RECRUITER_EMAIL_TASK, payload: queued[0] } as never);

    expect(mailbox.sendMessage).not.toHaveBeenCalled();
    expect(repository.claimPreparedOutreachMessage).not.toHaveBeenCalled();
    expect(repository.markOutreachMessageSent).not.toHaveBeenCalled();
  });
});
