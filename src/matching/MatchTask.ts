import { TaskQueue, ClaimedTask } from "../queue/TaskQueue";
import { JobOpportunityRepository } from "../jobs/domain/JobOpportunityRepository";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { MatchPipeline } from "./MatchPipeline";
import { JobRankingService } from "../jobs/policy/JobRankingService";
import { ApplicationTaskDispatcher } from "../applications/ApplicationTask";
import { RecruiterDiscoveryTaskDispatcher } from "../recruiters/RecruiterDiscoveryTask";
import { resolveEmployerDomainFromJobData, resolveEmployerDomainFromPublicSearch } from "../recruiters/RecruiterCompanyDomainResolver";
import { PERMANENTLY_EXCLUDED_COMPANIES } from "../applications/ApplicationPolicy";
import { AppConfig } from "../config/env";

export const MATCH_JOB_TASK = "MATCH_JOB";

export interface MatchJobTaskPayload { jobOpportunityId: string; candidateProfileId: string; }

export class MatchTaskDispatcher {
  constructor(private readonly queue: TaskQueue) {}
  async enqueue(jobOpportunityId: string, candidateProfileId: string, priority = 0): Promise<string> {
    return this.queue.enqueue<MatchJobTaskPayload>({ taskType: MATCH_JOB_TASK, payload: { jobOpportunityId, candidateProfileId }, priority, dedupeKey: `match:${jobOpportunityId}:${candidateProfileId}` });
  }
}

export class MatchTaskHandler {
  private readonly applications?: ApplicationTaskDispatcher;
  private readonly recruiters?: RecruiterDiscoveryTaskDispatcher;
  private readonly recruiterEnabled: boolean;
  private readonly excludedCompanies: readonly string[];
  private readonly logger?: Pick<Console, "info">;

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
    this.recruiterEnabled = config?.recruiterOutreach.enabled === true || process.env.RECRUITER_OUTREACH_ENABLED === "true";
    this.excludedCompanies = excludedCompanies;
  }

  async handle(task: ClaimedTask<MatchJobTaskPayload>): Promise<void> {
    if (task.taskType !== MATCH_JOB_TASK) throw new Error(`Unsupported match task type: ${task.taskType}`);
    const { jobOpportunityId, candidateProfileId } = task.payload;
    if (candidateProfileId !== this.profiles.id) throw new Error(`Unknown candidate profile: ${candidateProfileId}`);
    const job = await this.opportunities.findById(jobOpportunityId);
    if (!job) throw new Error(`Job opportunity not found: ${jobOpportunityId}`);

    const match = await this.pipeline.evaluateAndPersist(job, this.profiles);
    let rankedAndEligible = true;
    if (this.ranking) {
      const result = await this.ranking.rankAndPersist({ job, candidateProfileId, deterministicMatchScore: match.deterministic.matchScore, semanticMatchScore: match.semantic?.score ?? null });
      rankedAndEligible = result.persisted;
    }
    if (!rankedAndEligible) {
      recruiterDispatchDiagnostic(job, "JOB_RANKING_REJECTED", { decision: match.decision, matchScore: match.score });
      return;
    }

    const dispatches: Promise<unknown>[] = [];
    if (this.applications && match.decision === "APPLY") dispatches.push(this.applications.enqueue(jobOpportunityId, candidateProfileId, 30));
    // Recruiter intelligence is downstream of a positive/reviewable match. A
    // rejected job must not trigger employer/recruiter discovery work.
    if (this.recruiters && (match.decision === "APPLY" || match.decision === "REVIEW")) {
      dispatches.push(this.enqueueRecruiterDiscoveryIfEligible(job, candidateProfileId));
    }
    await Promise.all(dispatches);
  }

  private async enqueueRecruiterDiscoveryIfEligible(
    job: Awaited<ReturnType<JobOpportunityRepository["findById"]>>,
    candidateProfileId: string
  ): Promise<string | null> {
    if (!job || !this.recruiterEnabled || !this.recruiters) {
      recruiterDispatchDiagnostic(job, "RECRUITER_DISABLED_OR_UNAVAILABLE");
      return null;
    }
    if (isExcludedCompany(job.companyName, this.excludedCompanies)) {
      recruiterDispatchDiagnostic(job, "COMPANY_EXCLUDED");
      return null;
    }

    let companyDomain = resolveEmployerDomainFromJobData(job.companyDomain, job.canonicalUrl, job.description, job.companyName);
    if (companyDomain && !domainMatchesCompanyName(companyDomain, job.companyName)) {
      recruiterDispatchDiagnostic(job, "JOB_DATA_DOMAIN_FAILED_COMPANY_MATCH", { companyDomain });
      companyDomain = null;
    }
    if (!companyDomain && process.env.RECRUITER_PUBLIC_DOMAIN_SEARCH_ENABLED !== "false") {
      companyDomain = await resolveEmployerDomainFromPublicSearch(job.companyName);
      recruiterDispatchDiagnostic(job, companyDomain ? "PUBLIC_SEARCH_DOMAIN_RESOLVED" : "PUBLIC_SEARCH_DOMAIN_UNRESOLVED", { companyDomain });
    }
    if (!companyDomain || !domainMatchesCompanyName(companyDomain, job.companyName)) {
      recruiterDispatchDiagnostic(job, "NO_VALIDATED_EMPLOYER_DOMAIN", { companyDomain });
      return null;
    }

    const candidateName = this.profiles.fullName ?? ([this.profiles.firstName, this.profiles.lastName].filter(Boolean).join(" ") || "Candidate");
    const taskId = await this.recruiters.enqueue({
      companyName: job.companyName,
      companyDomain,
      jobTitle: job.title,
      jobDescription: job.description,
      location: job.location ?? undefined,
      candidateProfileId,
      candidateName,
      candidateSkills: this.profiles.skills,
      candidateYearsExperience: this.profiles.yearsExperience,
      candidateLocation: this.profiles.location,
      jobOpportunityId: job.id,
      applicationOutcome: "NOT_ATTEMPTED"
    }, 40);
    recruiterDispatchDiagnostic(job, "DISCOVER_RECRUITERS_ENQUEUED", { companyDomain, taskId });
    return taskId;
  }
}

function recruiterDispatchDiagnostic(
  job: Awaited<ReturnType<JobOpportunityRepository["findById"]>>,
  reason: string,
  extra: Record<string, unknown> = {}
): void {
  if (process.env.RECRUITER_DISPATCH_DIAGNOSTICS !== "true" || !job) return;
  console.log(JSON.stringify({
    event: "recruiter-dispatch",
    jobOpportunityId: job.id,
    company: job.companyName,
    role: job.title,
    canonicalUrl: job.canonicalUrl,
    reason,
    ...extra
  }));
}

function companyTokens(companyName: string): string[] {
  return companyName.toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !["the", "and", "inc", "ltd", "llc", "corp", "company", "limited", "private", "pvt"].includes(token));
}

function domainMatchesCompanyName(domain: string, companyName: string): boolean {
  const tokens = companyTokens(companyName);
  if (tokens.length === 0) return false;
  const host = domain.split(".")[0] ?? domain;
  return tokens.some((token) => host.includes(token));
}

function isExcludedCompany(companyName: string, configuredExcluded: readonly string[]): boolean {
  const normalized = companyName.trim().toLowerCase();
  return [...PERMANENTLY_EXCLUDED_COMPANIES, ...configuredExcluded].some((name) => name.trim().toLowerCase() === normalized);
}
