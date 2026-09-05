import { ClaimedTask } from "../queue/TaskQueue";
import { APPLY_JOB_TASK, ApplyJobTaskPayload } from "./ApplicationTask";
import { ApplicationRepository } from "./ApplicationRepository";

export class ApplicationTaskHandler {
  constructor(private readonly applications: ApplicationRepository) {}

  async handle(task: ClaimedTask<ApplyJobTaskPayload>): Promise<void> {
    if (task.taskType !== APPLY_JOB_TASK) {
      throw new Error(`Unsupported application task type: ${task.taskType}`);
    }

    // A policy block is a terminal, successful handling outcome for the queue.
    // Transient database/browser failures still throw and are retried by Worker.
    await this.applications.prepare(
      task.payload.jobOpportunityId,
      task.payload.candidateProfileId
    );
  }
}
