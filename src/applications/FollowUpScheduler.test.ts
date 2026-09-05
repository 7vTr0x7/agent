import { FollowUpScheduler } from "./FollowUpScheduler";
import { FollowUpDraftRepository } from "./FollowUpDraftRepository";
import { FollowUpTaskDispatcher } from "./FollowUpTask";

describe("FollowUpScheduler", () => {
  test("queues a due follow-up exactly once through the dispatcher", async () => {
    const repository = {
      findCandidates: jest.fn().mockResolvedValue([
        {
          applicationId: "app-1",
          jobTitle: "Frontend Engineer",
          companyName: "Example Co",
          appliedAt: new Date("2026-08-01T10:00:00Z"),
          lastFollowUpAt: null,
          nextFollowUpAt: new Date("2026-08-08T10:00:00Z"),
          hasRecruiterResponse: false,
          status: "SENT"
        }
      ]),
      markDue: jest.fn().mockResolvedValue(true)
    } as unknown as FollowUpDraftRepository;
    const dispatcher = {
      enqueue: jest.fn().mockResolvedValue("task-1")
    } as unknown as FollowUpTaskDispatcher;

    const scheduler = new FollowUpScheduler(repository, dispatcher);
    const result = await scheduler.runOnce(new Date("2026-08-09T10:00:00Z"));

    expect(result).toEqual({ scanned: 1, due: 1, queued: 1 });
    expect(repository.markDue).toHaveBeenCalledWith(
      "app-1",
      new Date("2026-08-16T10:00:00Z")
    );
    expect(dispatcher.enqueue).toHaveBeenCalledWith("app-1");
  });

  test("does not queue when recruiter has already responded", async () => {
    const repository = {
      findCandidates: jest.fn().mockResolvedValue([
        {
          applicationId: "app-2",
          jobTitle: "Frontend Engineer",
          companyName: "Example Co",
          appliedAt: new Date("2026-08-01T10:00:00Z"),
          lastFollowUpAt: null,
          nextFollowUpAt: new Date("2026-08-08T10:00:00Z"),
          hasRecruiterResponse: true,
          status: "SENT"
        }
      ]),
      markDue: jest.fn()
    } as unknown as FollowUpDraftRepository;
    const dispatcher = { enqueue: jest.fn() } as unknown as FollowUpTaskDispatcher;

    const scheduler = new FollowUpScheduler(repository, dispatcher);
    const result = await scheduler.runOnce(new Date("2026-08-09T10:00:00Z"));

    expect(result).toEqual({ scanned: 1, due: 0, queued: 0 });
    expect(repository.markDue).not.toHaveBeenCalled();
    expect(dispatcher.enqueue).not.toHaveBeenCalled();
  });
});
