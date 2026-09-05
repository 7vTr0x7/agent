import { FollowUpDraftRepository } from "./FollowUpDraftRepository";
import { FollowUpTaskHandler } from "./FollowUpTaskHandler";

describe("FollowUpTaskHandler", () => {
  test("creates a recruiter follow-up draft without sending it", async () => {
    const repository = {
      findCandidates: jest.fn().mockResolvedValue([
        {
          applicationId: "app-1",
          jobTitle: "Frontend Engineer",
          companyName: "Example Co",
          appliedAt: new Date("2026-08-01T10:00:00Z"),
          lastFollowUpAt: null,
          nextFollowUpAt: null,
          hasRecruiterResponse: false,
          status: "FOLLOW_UP_DUE"
        }
      ]),
      createDraft: jest.fn().mockResolvedValue({
        id: "draft-1",
        applicationId: "app-1",
        subject: "Following up on my application for Frontend Engineer",
        bodyText: "draft",
        status: "DRAFT"
      })
    } as unknown as FollowUpDraftRepository;

    const handler = new FollowUpTaskHandler(repository);
    await handler.handle({
      id: "task-1",
      taskType: "PREPARE_FOLLOW_UP",
      payload: { applicationId: "app-1" },
      status: "RUNNING",
      priority: 500,
      availableAt: new Date(),
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      lockedBy: "worker-1",
      attempts: 1,
      maxAttempts: 3,
      dedupeKey: "follow-up:app-1",
      workerId: "worker-1"
    });

    expect(repository.createDraft).toHaveBeenCalledWith(
      "app-1",
      "Following up on my application for Frontend Engineer",
      expect.stringContaining("I wanted to follow up on my application")
    );
  });

  test("does not draft after recruiter response", async () => {
    const repository = {
      findCandidates: jest.fn().mockResolvedValue([
        {
          applicationId: "app-2",
          jobTitle: "Frontend Engineer",
          companyName: "Example Co",
          appliedAt: new Date("2026-08-01T10:00:00Z"),
          lastFollowUpAt: null,
          nextFollowUpAt: null,
          hasRecruiterResponse: true,
          status: "FOLLOW_UP_DUE"
        }
      ]),
      createDraft: jest.fn()
    } as unknown as FollowUpDraftRepository;

    const handler = new FollowUpTaskHandler(repository);
    await handler.handle({
      id: "task-2",
      taskType: "PREPARE_FOLLOW_UP",
      payload: { applicationId: "app-2" },
      status: "RUNNING",
      priority: 500,
      availableAt: new Date(),
      lockedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      lockedBy: "worker-1",
      attempts: 1,
      maxAttempts: 3,
      dedupeKey: "follow-up:app-2",
      workerId: "worker-1"
    });

    expect(repository.createDraft).not.toHaveBeenCalled();
  });
});
