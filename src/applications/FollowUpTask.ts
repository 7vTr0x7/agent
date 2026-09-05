import { TaskQueue } from "../queue/TaskQueue";

export const PREPARE_FOLLOW_UP_TASK = "PREPARE_FOLLOW_UP";

export interface PrepareFollowUpTaskPayload {
  applicationId: string;
}

export class FollowUpTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueue(applicationId: string, availableAt: Date = new Date()): Promise<string> {
    return this.queue.enqueue<PrepareFollowUpTaskPayload>({
      taskType: PREPARE_FOLLOW_UP_TASK,
      payload: { applicationId },
      priority: 500,
      availableAt,
      dedupeKey: `follow-up:${applicationId}`
    });
  }
}
