import { ApplicationQueueService } from "./ApplicationQueueService";
import { ApplicationTaskDispatcher } from "./ApplicationTask";

describe("ApplicationQueueService", () => {
  it("queues APPLY decisions in ranking order and excludes existing applications", async () => {
    const enqueue = jest.fn().mockResolvedValue("task-id");
    const dispatcher = { enqueue } as unknown as ApplicationTaskDispatcher;
    const database = {
      query: jest.fn().mockResolvedValue({
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
      })
    };

    const service = new ApplicationQueueService(
      database as never,
      dispatcher
    );

    const result = await service.enqueueEligible("candidate-1", 50);

    expect(result).toEqual({ queued: 2 });
    expect(enqueue).toHaveBeenNthCalledWith(1, "job-1", "candidate-1", 3092);
    expect(enqueue).toHaveBeenNthCalledWith(2, "job-2", "candidate-1", 2081);
  });
});
