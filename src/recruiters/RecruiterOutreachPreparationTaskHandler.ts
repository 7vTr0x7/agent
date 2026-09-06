import { ClaimedTask } from "../queue/TaskQueue";
import { PREPARE_RECRUITER_OUTREACH_TASK, PrepareRecruiterOutreachTaskPayload } from "./RecruiterOutreachPreparationTask";
import { RecruiterOutreachPreparationService } from "./RecruiterOutreachPreparationService";
import { RecruiterOutreachSendTaskDispatcher } from "./RecruiterOutreachSendTask";

export class RecruiterOutreachPreparationTaskHandler {
  constructor(
    private readonly preparation: RecruiterOutreachPreparationService,
    private readonly sendDispatcher?: RecruiterOutreachSendTaskDispatcher,
    private readonly logger?: Pick<Console, "error" | "info">
  ) {}

  async handle(task: ClaimedTask<PrepareRecruiterOutreachTaskPayload>): Promise<void> {
    if (task.taskType !== PREPARE_RECRUITER_OUTREACH_TASK) throw new Error(`Unsupported recruiter outreach preparation task type: ${task.taskType}`);
    try {
      const prepared=await this.preparation.prepare({
        companyName:task.payload.companyName,companyDomain:task.payload.companyDomain,jobTitle:task.payload.jobTitle,
        jobDescription:task.payload.jobDescription,jobOpportunityId:task.payload.jobOpportunityId,applicationId:task.payload.applicationId,
        candidateProfileId:task.payload.candidateProfileId,candidateName:task.payload.candidateName
      },task.payload.contacts);
      if(this.sendDispatcher){for(const item of prepared) await this.sendDispatcher.enqueue({messageId:item.message.id,companyDomain:task.payload.companyDomain});}
      this.logger?.info(`[recruiter-outreach] ${task.payload.companyName}: prepared ${prepared.length} message(s); send tasks queued=${this.sendDispatcher ? prepared.length : 0}.`);
    } catch(error){this.logger?.error(`[recruiter-outreach] ${task.payload.companyName}: ${error instanceof Error ? error.message : String(error)}`);}
  }
}
