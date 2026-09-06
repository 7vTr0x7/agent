import { ClaimedTask } from "../queue/TaskQueue";
import {
  PREPARE_RECRUITER_OUTREACH_TASK,
  PrepareRecruiterOutreachTaskPayload
} from "./RecruiterOutreachPreparationTask";
import { RecruiterOutreachPreparationService } from "./RecruiterOutreachPreparationService";

export class RecruiterOutreachPreparationTaskHandler {
  constructor(
    private readonly preparation: RecruiterOutreachPreparationService,
    private readonly logger?: Pick<Console, "error" | "info">
  ) {}

  async handle(task: ClaimedTask<PrepareRecruiterOutreachTaskPayload>): Promise<void> {
    if (task.taskType !== PREPARE_RECRUITER_OUTREACH_TASK) {
      throw new Error(`Unsupported recruiter outreach preparation task type: ${task.taskType}`);
    }

    try {
      const prepared = await this.preparation.prepare(
        {
          companyName: task.payload.companyName,
          companyDomain: task.payload.companyDomain,
          jobTitle: task.payload.jobTitle,
          jobDescription: task.payload.jobDescription,
          jobOpportunityId: task.payload.jobOpportunityId,
          applicationId: task.payload.applicationId,
          candidateProfileId: task.payload.candidateProfileId,
          candidateName: task.payload.candidateName
        },
        task.payload.contacts
      );

      this.logger?.info(
        `[recruiter-outreach] ${task.payload.companyName}: prepared ${prepared.length} message(s); sending remains disabled.`
      );
    } catch (error) {
      // Outreach preparation must never mutate application success/failure state.
      this.logger?.error(
        `[recruiter-outreach] ${task.payload.companyName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
