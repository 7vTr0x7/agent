import { TaskQueue } from "../queue/TaskQueue";

export const PROACTIVE_RECRUITER_DISCOVERY_TASK = "PROACTIVE_RECRUITER_DISCOVERY";
export const PROACTIVE_RECRUITER_OUTREACH_TASK = "PROACTIVE_RECRUITER_OUTREACH";

export interface ProactiveRecruiterDiscoveryPayload {
  candidateProfileId: string;
  candidateName?: string;
  yearsExperience: number;
  skills: string[];
  targetRoles: string[];
  location?: string;
  preferredLocations?: string[];
  remoteEligible?: boolean;
  maxCandidates: number;
}

export interface ProactiveRecruiterOutreachPayload {
  messageId: string;
  candidateProfileId: string;
}

export class ProactiveRecruiterTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueueDiscovery(payload: ProactiveRecruiterDiscoveryPayload): Promise<string> {
    return this.queue.enqueue({
      taskType: PROACTIVE_RECRUITER_DISCOVERY_TASK,
      payload,
      priority: 35,
      dedupeKey: `proactive-recruiter:${payload.candidateProfileId}`
    });
  }

  async enqueueOutreach(payload: ProactiveRecruiterOutreachPayload): Promise<string> {
    return this.queue.enqueue({
      taskType: PROACTIVE_RECRUITER_OUTREACH_TASK,
      payload,
      priority: 30,
      dedupeKey: `proactive-recruiter-outreach:${payload.messageId}`
    });
  }
}
