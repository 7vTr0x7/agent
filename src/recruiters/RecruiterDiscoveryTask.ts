import { TaskQueue } from "../queue/TaskQueue";

export const DISCOVER_RECRUITERS_TASK = "DISCOVER_RECRUITERS";

export interface DiscoverRecruitersTaskPayload {
  companyName: string;
  companyDomain: string;
  jobTitle: string;
  jobDescription: string;
  location?: string;
  candidateProfileId: string;
  jobOpportunityId: string;
  applicationId: string;
}

export class RecruiterDiscoveryTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueue(payload: DiscoverRecruitersTaskPayload, priority = 40): Promise<string> {
    return this.queue.enqueue<DiscoverRecruitersTaskPayload>({
      taskType: DISCOVER_RECRUITERS_TASK,
      payload,
      priority,
      dedupeKey: `recruiter-discovery:${payload.jobOpportunityId}:${payload.candidateProfileId}`
    });
  }
}
