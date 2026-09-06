import { TaskQueue } from "../queue/TaskQueue";
import { StoredRecruiterContact } from "./RecruiterDiscoveryRepository";

export const PREPARE_RECRUITER_OUTREACH_TASK = "PREPARE_RECRUITER_OUTREACH";

export interface PrepareRecruiterOutreachTaskPayload {
  companyName: string;
  companyDomain: string;
  jobTitle: string;
  jobDescription: string;
  jobOpportunityId: string;
  applicationId: string;
  candidateProfileId: string;
  candidateName: string;
  contacts: StoredRecruiterContact[];
}

export class RecruiterOutreachPreparationTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueue(payload: PrepareRecruiterOutreachTaskPayload, priority = 35): Promise<string> {
    return this.queue.enqueue<PrepareRecruiterOutreachTaskPayload>({
      taskType: PREPARE_RECRUITER_OUTREACH_TASK,
      payload,
      priority,
      dedupeKey: `recruiter-outreach-preparation:${payload.jobOpportunityId}:${payload.candidateProfileId}`
    });
  }
}
