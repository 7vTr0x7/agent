import { ClaimedTask } from "../queue/TaskQueue";
import { APPLY_JOB_TASK, ApplyJobTaskPayload } from "./ApplicationTask";
import { ApplicationRepository } from "./ApplicationRepository";

export class ApplicationTaskHandler {
  constructor(private readonly applications: ApplicationRepository) {}

  async handle(task: ClaimedTask<ApplyJobTaskPayload>): Promise<void> {
    if (task.taskType !== APPLY_JOB_TASK) {
      throw new Error(`Unsupported application task type: ${task.taskType}`);
    }

    const result = await this.applications.prepare(
      task.payload.jobOpportunityId,
      task.payload.candidateProfileId
    );

    if (!result.prepared) {
      throw new Error(`Application preparation blocked: ${result.reason}`);
    }
  }
}
