import { TaskQueue } from "../queue/TaskQueue";

export const APPLY_JOB_TASK = "APPLY_JOB";

export interface ApplyJobTaskPayload {
  jobOpportunityId: string;
  candidateProfileId: string;
}

export class ApplicationTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueue(
    jobOpportunityId: string,
    candidateProfileId: string,
    priority: number
  ): Promise<string> {
    return this.queue.enqueue<ApplyJobTaskPayload>({
      taskType: APPLY_JOB_TASK,
      payload: { jobOpportunityId, candidateProfileId },
      priority,
      dedupeKey: `apply:${jobOpportunityId}:${candidateProfileId}`
    });
  }
}
