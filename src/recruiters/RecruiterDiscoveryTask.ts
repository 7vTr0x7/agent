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
      // The queue intentionally deduplicates only PENDING/RUNNING tasks.
      // A time bucket keeps successful zero-result discoveries from being
      // re-enqueued every matching cycle while still refreshing public data.
      dedupeKey: `recruiter-discovery:${RECRUITER_DISCOVERY_DEDUPE_VERSION}:${payload.jobOpportunityId}:${payload.candidateProfileId}:${refreshBucket}`
    });
  }
}
