import { ApplicationQueueService } from "./ApplicationQueueService";
import { ApplicationTaskDispatcher } from "./ApplicationTask";
import { ApplicationRateLimitPolicy } from "./ApplicationRateLimitPolicy";
import { ApplicationCompanyRateLimitPolicy } from "./ApplicationCompanyRateLimitPolicy";

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
      new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 10 }),
      new ApplicationCompanyRateLimitPolicy({ maxSubmissionsPerCompanyPerDay: 5 })
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
      new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 10 }),
      new ApplicationCompanyRateLimitPolicy({ maxSubmissionsPerCompanyPerDay: 5 })
    );

    const result = await service.enqueueEligible("candidate-1", 50);

    expect(result.submissionsRemaining).toBe(1);
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("LIMIT $3"),
      ["candidate-1", 5, 2]
    );
  });

  it("passes the company cap into the candidate selection query", async () => {
    const enqueue = jest.fn().mockResolvedValue("task-id");
    const dispatcher = { enqueue } as unknown as ApplicationTaskDispatcher;
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [] });
    const database = { query };

    const service = new ApplicationQueueService(
      database as never,
      dispatcher,
      new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 10 }),
      new ApplicationCompanyRateLimitPolicy({ maxSubmissionsPerCompanyPerDay: 3 })
    );

    await service.enqueueEligible("candidate-1", 10);

    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("company_submission_counts"),
      ["candidate-1", 3, 10]
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("company_rank <= GREATEST(0, $2 - company_submissions_used)"),
      ["candidate-1", 3, 10]
    );
  });
});
