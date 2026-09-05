import { ClaimedTask } from "../queue/TaskQueue";
import { TaskHandler } from "../queue/TaskWorker";
import { FollowUpDraftRepository } from "./FollowUpDraftRepository";
import { PrepareFollowUpTaskPayload } from "./FollowUpTask";

export class FollowUpTaskHandler implements TaskHandler<PrepareFollowUpTaskPayload> {
  constructor(private readonly drafts: FollowUpDraftRepository) {}

  async handle(task: ClaimedTask<PrepareFollowUpTaskPayload>): Promise<void> {
    const candidates = await this.drafts.findCandidates(100);
    const candidate = candidates.find((item) => item.applicationId === task.payload.applicationId);

    if (!candidate) {
      return;
    }

    if (candidate.hasRecruiterResponse) {
      return;
    }

    const subject = `Following up on my application for ${candidate.jobTitle}`;
    const body = [
      `Hello ${candidate.companyName} hiring team,`,
      "",
      `I wanted to follow up on my application for the ${candidate.jobTitle} position and check whether there are any updates on the hiring process.`,
      "",
      "I remain very interested in the opportunity and would be happy to provide any additional information needed.",
      "",
      "Best regards,",
      "Salman Shaikh"
    ].join("\n");

    await this.drafts.createDraft(candidate.applicationId, subject, body);
  }
}
