import { TaskQueue } from "../queue/TaskQueue";
import { RecruiterApplicationOutcome } from "./RecruiterOutreachPreparationService";

export const DISCOVER_RECRUITERS_TASK = "DISCOVER_RECRUITERS";
const RECRUITER_DISCOVERY_DEDUPE_VERSION = "v3";
const RECRUITER_DISCOVERY_REFRESH_BUCKET_MS = 6 * 60 * 60 * 1000;

export interface DiscoverRecruitersTaskPayload {
  companyName: string;
  companyDomain: string;
  jobTitle: string;
  jobDescription: string;
  location?: string;
  candidateProfileId: string;
  candidateName?: string;
  candidateSkills?: readonly string[];
  candidateYearsExperience?: number;
  candidateLocation?: string;
  jobOpportunityId: string;
  applicationId?: string;
  applicationOutcome?: RecruiterApplicationOutcome;
}

export class RecruiterDiscoveryTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueue(payload: DiscoverRecruitersTaskPayload, priority = 40): Promise<string> {
    const refreshBucket = Math.floor(Date.now() / RECRUITER_DISCOVERY_REFRESH_BUCKET_MS);
    return this.queue.enqueue<DiscoverRecruitersTaskPayload>({
      taskType: DISCOVER_RECRUITERS_TASK,
      payload,
      priority,
      dedupeKey: `recruiter-discovery:${RECRUITER_DISCOVERY_DEDUPE_VERSION}:${payload.jobOpportunityId}:${payload.candidateProfileId}:${refreshBucket}`
    });
  }
}
