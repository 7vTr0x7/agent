import { ApplicationQueueService } from "./ApplicationQueueService";
import { ApplicationTaskDispatcher } from "./ApplicationTask";
import { ApplicationRateLimitPolicy } from "./ApplicationRateLimitPolicy";

describe("ApplicationQueueService", () => {
  it("queues APPLY decisions in ranking order and excludes existing applications", async () => {
    const enqueue = jest.fn().mockResolvedValue("task-id");
    const dispatcher = { enqueue } as unknown as ApplicationTaskDispatcher;
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: "4" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            job_opportunity_id: "job-1",
            candidate_profile_id: "candidate-1",
            tier: 1,
            rank_score: 92
          },
          {
            job_opportunity_id: "job-2",
            candidate_profile_id: "candidate-1",
            tier: 2,
            rank_score: 81
          }
        ]
      });
    const database = { query };

    const service = new ApplicationQueueService(
      database as never,
      dispatcher,
      new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 10 })
    );

    const result = await service.enqueueEligible("candidate-1", 50);

    expect(result).toEqual({
      queued: 2,
      rateLimited: false,
      submissionsUsed: 4,
      submissionsRemaining: 4
    });
    expect(enqueue).toHaveBeenNthCalledWith(1, "job-1", "candidate-1", 3092);
    expect(enqueue).toHaveBeenNthCalledWith(2, "job-2", "candidate-1", 2081);
  });

  it("does not queue work once the daily submission limit is reached", async () => {
    const enqueue = jest.fn().mockResolvedValue("task-id");
    const dispatcher = { enqueue } as unknown as ApplicationTaskDispatcher;
    const query = jest.fn().mockResolvedValueOnce({ rows: [{ count: "10" }] });
    const database = { query };

    const service = new ApplicationQueueService(
      database as never,
      dispatcher,
      new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 10 })
    );

    const result = await service.enqueueEligible("candidate-1", 50);

    expect(result).toEqual({
      queued: 0,
      rateLimited: true,
      submissionsUsed: 10,
      submissionsRemaining: 0
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("caps the queue batch at the remaining daily submission budget", async () => {
    const enqueue = jest.fn().mockResolvedValue("task-id");
    const dispatcher = { enqueue } as unknown as ApplicationTaskDispatcher;
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: "8" }] })
      .mockResolvedValueOnce({
        rows: [
          {
            job_opportunity_id: "job-1",
            candidate_profile_id: "candidate-1",
            tier: 1,
            rank_score: 92
          }
        ]
      });
    const database = { query };

    const service = new ApplicationQueueService(
      database as never,
      dispatcher,
      new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 10 })
    );

    const result = await service.enqueueEligible("candidate-1", 50);

    expect(result.submissionsRemaining).toBe(1);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("LIMIT $2"),
      ["candidate-1", 2]
    );
  });
});
