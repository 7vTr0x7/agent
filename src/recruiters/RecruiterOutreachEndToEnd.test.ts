import { RecruiterDiscoveryTaskHandler } from "./RecruiterDiscoveryTaskHandler";
import { RecruiterOutreachPreparationService } from "./RecruiterOutreachPreparationService";
import { RecruiterOutreachPreparationTaskHandler } from "./RecruiterOutreachPreparationTaskHandler";
import { RecruiterOutreachSendService } from "./RecruiterOutreachSendService";
import { RecruiterOutreachSendTaskHandler } from "./RecruiterOutreachSendTaskHandler";
import { SEND_RECRUITER_EMAIL_TASK } from "./RecruiterOutreachSendTask";
import { RecruiterDiscoveryTaskPayload } from "./RecruiterDiscoveryTask";
import { StoredRecruiterContact } from "./RecruiterDiscoveryRepository";

function recruiterContact(): StoredRecruiterContact {
  return {
    id: "contact-1",
    companyName: "Acme Co",
    companyDomain: "acme.dev",
    email: "recruiter@acme.dev",
    fullName: "Alex Recruiter",
    title: "Technical Recruiter",
    department: "Talent Acquisition",
    confidence: 95,
    verified: true,
    verificationStatus: "valid",
    provider: "hunter"
  };
}

function discoveryTask(): any {
  const payload: RecruiterDiscoveryTaskPayload = {
    companyName: "Acme Co",
    companyDomain: "acme.dev",
    jobTitle: "Frontend Engineer",
    jobDescription: "Build React applications.",
    location: "Bengaluru, India",
    jobOpportunityId: "job-1",
    applicationId: "application-1",
    candidateProfileId: "candidate-1",
    candidateName: "Salman Shaikh"
  };
  return { taskType: "DISCOVER_RECRUITERS", payload };
}

describe("Recruiter outreach end-to-end pipeline", () => {
  it("flows discovery -> preparation -> send queue -> dry-run send without Gmail", async () => {
    const contact = recruiterContact();
    const discovery = {
      discoverAndPersist: jest.fn().mockResolvedValue({
        status: "DISCOVERED",
        reason: "Persisted 1 eligible recruiter contact.",
        runId: "run-1",
        contacts: [contact]
      })
    };

    const preparationQueue: any[] = [];
    const sendQueue: any[] = [];
    const preparationDispatcher = {
      enqueue: jest.fn().mockImplementation(async (payload) => {
        preparationQueue.push(payload);
        return "prepare-task-1";
      })
    };
    const sendDispatcher = {
      enqueue: jest.fn().mockImplementation(async (payload) => {
        sendQueue.push(payload);
        return "send-task-1";
      })
    };

    const discoveryHandler = new RecruiterDiscoveryTaskHandler(
      discovery as never,
      3,
      preparationDispatcher as never
    );
    await discoveryHandler.handle(discoveryTask());

    expect(discovery.discoverAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: "Acme Co",
        companyDomain: "acme.dev",
        jobTitle: "Frontend Engineer",
        location: "Bengaluru, India"
      }),
      3
    );
    expect(preparationDispatcher.enqueue).toHaveBeenCalledTimes(1);
    expect(preparationQueue).toHaveLength(1);

    const preparedMessage = {
      id: "message-1",
      sequenceId: "sequence-1",
      messageType: "INITIAL",
      sequenceStep: 0,
      recipientEmail: contact.email,
      subject: "Application for Frontend Engineer at Acme Co",
      body: "I’m Salman Shaikh, and I’m interested in the Frontend Engineer opportunity at Acme Co.",
      status: "PREPARED"
    } as const;
    const repository = {
      isSuppressed: jest.fn().mockResolvedValue({ email: false, domain: false }),
      isOutreachSequenceDuplicate: jest.fn().mockResolvedValue(false),
      createOutreachSequence: jest.fn().mockResolvedValue({
        id: "sequence-1",
        recruiterContactId: contact.id,
        jobOpportunityId: "job-1",
        applicationId: "application-1",
        candidateProfileId: "candidate-1",
        status: "READY",
        nextActionAt: null,
        followUpCount: 0
      }),
      createOutreachMessage: jest.fn().mockResolvedValue(preparedMessage),
      getOutreachMessage: jest.fn().mockResolvedValue(preparedMessage),
      countSentOutreachMessagesSince: jest.fn().mockResolvedValue(0),
      claimPreparedOutreachMessage: jest.fn(),
      markOutreachMessageSent: jest.fn(),
      markOutreachMessageFailed: jest.fn()
    };

    const preparation = new RecruiterOutreachPreparationService({
      repository: repository as never,
      dryRun: true
    });
    const preparationHandler = new RecruiterOutreachPreparationTaskHandler(
      preparation,
      sendDispatcher as never
    );

    await preparationHandler.handle({
      taskType: "PREPARE_RECRUITER_OUTREACH",
      payload: preparationQueue[0]
    } as never);

    expect(sendDispatcher.enqueue).toHaveBeenCalledTimes(1);
    expect(sendQueue).toEqual([{ messageId: "message-1", companyDomain: "acme.dev" }]);

    const mailbox = { sendMessage: jest.fn() };
    const sendService = new RecruiterOutreachSendService({
      repository: repository as never,
      mailbox: mailbox as never,
      dryRun: true
    });
    const sendHandler = new RecruiterOutreachSendTaskHandler(sendService, repository as never);

    await sendHandler.handle({
      taskType: SEND_RECRUITER_EMAIL_TASK,
      payload: sendQueue[0]
    } as never);

    expect(mailbox.sendMessage).not.toHaveBeenCalled();
    expect(repository.claimPreparedOutreachMessage).not.toHaveBeenCalled();
    expect(repository.markOutreachMessageSent).not.toHaveBeenCalled();
  });

  it("does not enqueue outreach for a failed discovery result", async () => {
    const preparationDispatcher = { enqueue: jest.fn() };
    const discovery = {
      discoverAndPersist: jest.fn().mockResolvedValue({
        status: "SKIPPED",
        reason: "No eligible recruiter contacts.",
        runId: null,
        contacts: []
      })
    };

    const handler = new RecruiterDiscoveryTaskHandler(
      discovery as never,
      3,
      preparationDispatcher as never
    );

    await handler.handle(discoveryTask());

    expect(preparationDispatcher.enqueue).not.toHaveBeenCalled();
  });
});
