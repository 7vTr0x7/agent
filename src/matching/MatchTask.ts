import { TaskQueue } from "../queue/TaskQueue";
import { JobOpportunityRepository } from "../jobs/domain/JobOpportunityRepository";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { MatchPipeline } from "./MatchPipeline";
import { ClaimedTask } from "../queue/TaskQueue";

export const MATCH_JOB_TASK = "MATCH_JOB";

export interface MatchJobTaskPayload {
  jobOpportunityId: string;
  candidateProfileId: string;
}

export class MatchTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}

  async enqueue(jobOpportunityId: string, candidateProfileId: string, priority = 0): Promise<string> {
    return this.queue.enqueue<MatchJobTaskPayload>({
      taskType: MATCH_JOB_TASK,
      payload: { jobOpportunityId, candidateProfileId },
      priority,
      dedupeKey: `match:${jobOpportunityId}:${candidateProfileId}`
    });
  }
}

export class MatchTaskHandler {
  constructor(
    private readonly opportunities: JobOpportunityRepository,
    private readonly profiles: CandidateProfile,
    private readonly pipeline: MatchPipeline
  ) {}

  async handle(task: ClaimedTask<MatchJobTaskPayload>): Promise<void> {
    const { jobOpportunityId, candidateProfileId } = task.payload;

    if (candidateProfileId !== this.profiles.id) {
      throw new Error(`Unknown candidate profile: ${candidateProfileId}`);
    }

    const job = await this.opportunities.findById(jobOpportunityId);
    if (!job) {
      throw new Error(`Job opportunity not found: ${jobOpportunityId}`);
    }

    await this.pipeline.evaluateAndPersist(job, this.profiles);
  }
}
