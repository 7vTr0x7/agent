import { TaskQueue, ClaimedTask } from "../queue/TaskQueue";
import { JobOpportunityRepository } from "../jobs/domain/JobOpportunityRepository";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { MatchPipeline } from "./MatchPipeline";
import { JobRankingService } from "../jobs/policy/JobRankingService";
import { ApplicationTaskDispatcher } from "../applications/ApplicationTask";
import { RecruiterDiscoveryTaskDispatcher } from "../recruiters/RecruiterDiscoveryTask";
import { resolveEmployerDomainFromJobUrl } from "../recruiters/RecruiterCompanyDomainResolver";
import { PERMANENTLY_EXCLUDED_COMPANIES } from "../applications/ApplicationPolicy";
import { AppConfig } from "../config/env";

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
  private readonly applications?: ApplicationTaskDispatcher;
  private readonly recruiters?: RecruiterDiscoveryTaskDispatcher;
  private readonly recruiterEnabled: boolean;
  private readonly excludedCompanies: readonly string[];

  constructor(
    private readonly opportunities: JobOpportunityRepository,
    private readonly profiles: CandidateProfile,
    private readonly pipeline: MatchPipeline,
    private readonly ranking?: JobRankingService,
    taskQueue?: TaskQueue,
    config?: AppConfig,
    excludedCompanies: readonly string[] = []
  ) {
    if (taskQueue) {
      this.applications = new ApplicationTaskDispatcher(taskQueue);
      this.recruiters = new RecruiterDiscoveryTaskDispatcher(taskQueue);
    }
    this.recruiterEnabled = config?.recruiterOutreach.enabled ?? false;
    this.excludedCompanies = excludedCompanies;
  }

  async handle(task: ClaimedTask<MatchJobTaskPayload>): Promise<void> {
    if (task.taskType !== MATCH_JOB_TASK) throw new Error(`Unsupported match task type: ${task.taskType}`);

    const { jobOpportunityId, candidateProfileId } = task.payload;
    if (candidateProfileId !== this.profiles.id) {
      throw new Error(`Unknown candidate profile: ${candidateProfileId}`);
    }

    const job = await this.opportunities.findById(jobOpportunityId);
    if (!job) throw new Error(`Job opportunity not found: ${jobOpportunityId}`);

    const match = await this.pipeline.evaluateAndPersist(job, this.profiles);

    let rankedAndEligible = true;
    if (this.ranking) {
      const result = await this.ranking.rankAndPersist({
        job,
        candidateProfileId,
        deterministicMatchScore: match.deterministic.matchScore,
        semanticMatchScore: match.semantic?.score ?? null
      });
      rankedAndEligible = result.persisted;
    }

    if (!rankedAndEligible) return;

    // MATCH_JOB is the fan-out point. Application submission and recruiter
    // discovery are independent sibling pipelines. Neither waits for the
    // other, and recruiter discovery never depends on application outcome.
    const dispatches: Promise<unknown>[] = [];

    if (this.applications) {
      dispatches.push(this.applications.enqueue(jobOpportunityId, candidateProfileId, 30));
    }

    if (this.recruiters) {
      dispatches.push(this.enqueueRecruiterDiscoveryIfEligible(job, candidateProfileId));
    }

    await Promise.all(dispatches);
  }

  private async enqueueRecruiterDiscoveryIfEligible(
    job: Awaited<ReturnType<JobOpportunityRepository["findById"]>>,
    candidateProfileId: string
  ): Promise<string | null> {
    if (!job || !this.recruiterEnabled || !this.recruiters) return null;
    if (isExcludedCompany(job.companyName, this.excludedCompanies)) return null;

    const companyDomain = job.companyDomain ?? resolveEmployerDomainFromJobUrl(job.canonicalUrl);
    if (!companyDomain) return null;

    const candidateName = this.profiles.fullName ?? ([this.profiles.firstName, this.profiles.lastName].filter(Boolean).join(" ") || "Candidate");
    return this.recruiters.enqueue({
      companyName: job.companyName,
      companyDomain,
      jobTitle: job.title,
      jobDescription: job.description,
      location: job.location ?? undefined,
      candidateProfileId,
      candidateName,
      jobOpportunityId: job.id,
      applicationOutcome: "NOT_ATTEMPTED"
    }, 40);
  }
}

function isExcludedCompany(companyName: string, configuredExcluded: readonly string[]): boolean {
  const normalized = companyName.trim().toLowerCase();
  return [...PERMANENTLY_EXCLUDED_COMPANIES, ...configuredExcluded].some((name) => name.trim().toLowerCase() === normalized);
}
