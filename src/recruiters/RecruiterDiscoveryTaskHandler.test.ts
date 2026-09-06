import { ClaimedTask } from "../queue/TaskQueue";
import { DISCOVER_RECRUITERS_TASK, DiscoverRecruitersTaskPayload } from "./RecruiterDiscoveryTask";
import { RecruiterDiscoveryTaskHandler } from "./RecruiterDiscoveryTaskHandler";
import { PersistentRecruiterDiscoveryService } from "./PersistentRecruiterDiscoveryService";
import { RecruiterOutreachPreparationTaskDispatcher } from "./RecruiterOutreachPreparationTask";
import { StoredRecruiterContact } from "./RecruiterDiscoveryRepository";

const contact: StoredRecruiterContact = {
  id: "contact-1",
  companyName: "Acme",
  companyDomain: "acme.dev",
  email: "recruiter@acme.dev",
  fullName: "Alex Recruiter",
  title: "Technical Recruiter",
  confidence: 95,
  verified: true,
  verificationStatus: "valid",
  provider: "hunter"
};

function task(overrides: Partial<DiscoverRecruitersTaskPayload> = {}): ClaimedTask<DiscoverRecruitersTaskPayload> {
  return {
    id: "task-1",
    taskType: DISCOVER_RECRUITERS_TASK,
    payload: {
      companyName: "Acme",
      companyDomain: "acme.dev",
      jobTitle: "Frontend Engineer",
      jobDescription: "Build React applications.",
      jobOpportunityId: "job-1",
      applicationId: "app-1",
      candidateProfileId: "candidate-1",
      candidateName: "Salman Shaikh",
      ...overrides
    },
    status: "RUNNING",
    priority: 35,
    availableAt: new Date(),
    lockedAt: new Date(),
    leaseExpiresAt: new Date(Date.now() + 60_000),
    lockedBy: "worker-1",
    attempts: 1,
    maxAttempts: 3,
    dedupeKey: "recruiter-discovery:job-1:candidate-1",
    workerId: "worker-1"
  };
}

describe("RecruiterDiscoveryTaskHandler", () => {
  it("queues exactly one preparation task after successful discovery", async () => {
    const discovery = {
      discoverAndPersist: jest.fn().mockResolvedValue({
        status: "DISCOVERED",
        reason: "found",
        runId: "run-1",
        contacts: [contact]
      })
    } as unknown as PersistentRecruiterDiscoveryService;
    const enqueue = jest.fn().mockResolvedValue("prep-task-1");
    const dispatcher = { enqueue } as unknown as RecruiterOutreachPreparationTaskDispatcher;
    const handler = new RecruiterDiscoveryTaskHandler(discovery, 3, dispatcher);

    await handler.handle(task());

    expect(discovery.discoverAndPersist).toHaveBeenCalledWith(
      expect.objectContaining({ candidateProfileId: "candidate-1", jobOpportunityId: "job-1" }),
      3
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      companyDomain: "acme.dev",
      jobOpportunityId: "job-1",
      applicationId: "app-1",
      candidateProfileId: "candidate-1",
      candidateName: "Salman Shaikh",
      contacts: [contact]
    }));
  });

  it("does not queue preparation when discovery finds no contacts", async () => {
    const discovery = {
      discoverAndPersist: jest.fn().mockResolvedValue({
        status: "DISCOVERED",
        reason: "no eligible contacts",
        runId: "run-2",
        contacts: []
      })
    } as unknown as PersistentRecruiterDiscoveryService;
    const enqueue = jest.fn();
    const dispatcher = { enqueue } as unknown as RecruiterOutreachPreparationTaskDispatcher;
    const handler = new RecruiterDiscoveryTaskHandler(discovery, 3, dispatcher);

    await handler.handle(task());

    expect(enqueue).not.toHaveBeenCalled();
  });

  it("does not queue preparation when discovery is skipped", async () => {
    const discovery = {
      discoverAndPersist: jest.fn().mockResolvedValue({
        status: "SKIPPED",
        reason: "cooldown",
        runId: null,
        contacts: []
      })
    } as unknown as PersistentRecruiterDiscoveryService;
    const enqueue = jest.fn();
    const dispatcher = { enqueue } as unknown as RecruiterOutreachPreparationTaskDispatcher;
    const handler = new RecruiterDiscoveryTaskHandler(discovery, 3, dispatcher);

    await handler.handle(task());

    expect(enqueue).not.toHaveBeenCalled();
  });

  it("contains preparation enqueue failures without throwing", async () => {
    const discovery = {
      discoverAndPersist: jest.fn().mockResolvedValue({
        status: "DISCOVERED",
        reason: "found",
        runId: "run-3",
        contacts: [contact]
      })
    } as unknown as PersistentRecruiterDiscoveryService;
    const enqueue = jest.fn().mockRejectedValue(new Error("queue unavailable"));
    const dispatcher = { enqueue } as unknown as RecruiterOutreachPreparationTaskDispatcher;
    const logger = { error: jest.fn(), info: jest.fn() };
    const handler = new RecruiterDiscoveryTaskHandler(discovery, 3, dispatcher, logger);

    await expect(handler.handle(task())).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("queue unavailable"));
  });
});
