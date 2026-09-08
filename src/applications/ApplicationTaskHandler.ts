import { ClaimedTask } from "../queue/TaskQueue";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { APPLY_JOB_TASK, ApplyJobTaskPayload } from "./ApplicationTask";
import { ApplicationRepository } from "./ApplicationRepository";
import { ApplicationSubmissionService, ApplicationSubmissionOutcome } from "./ApplicationSubmissionService";
import { ApplicationEmailContext } from "../notifications/Email";
import { TailoredResumeArtifactService } from "../resume/TailoredResumeArtifactService";
import { TailoredResumeRepository } from "../resume/TailoredResumeRepository";
import { ApplicationAttemptRepository } from "./ApplicationAttemptRepository";

export interface CandidateProfileResolver { getById(candidateProfileId: string): Promise<CandidateProfile | null>; }
export interface ApplicationEmailDispatcher {
  enqueueApplicationSubmitted(context: ApplicationEmailContext): Promise<string>;
  enqueueApplicationBlocked(context: ApplicationEmailContext): Promise<string>;
}

export class ApplicationTaskHandler {
  constructor(
    private readonly applications: Pick<ApplicationRepository, "prepare">,
    private readonly submissions: Pick<ApplicationSubmissionService, "submit">,
    private readonly candidateProfiles: CandidateProfileResolver,
    private readonly excludedCompanies: readonly string[] = [],
    private readonly emailDispatcher?: ApplicationEmailDispatcher,
    private readonly tailoredResumeArtifacts?: TailoredResumeArtifactService,
    private readonly tailoredResumeRepository?: TailoredResumeRepository,
    private readonly attemptRepository?: Pick<ApplicationAttemptRepository, "record">,
    // Kept as an ignored compatibility slot for callers from the previous
    // workflow. Recruiter discovery is now owned by MATCH_JOB fan-out.
    _legacyRecruiterDiscoveryDispatcher?: unknown
  ) {}

  async handle(task: ClaimedTask<ApplyJobTaskPayload>): Promise<void> {
    if (task.taskType !== APPLY_JOB_TASK) throw new Error(`Unsupported application task type: ${task.taskType}`);
    const prepared = await this.applications.prepare(task.payload.jobOpportunityId, task.payload.candidateProfileId);
    if (!prepared.prepared) {
      console.warn(JSON.stringify({
        level: 40,
        taskId: task.id,
        taskType: task.taskType,
        jobOpportunityId: task.payload.jobOpportunityId,
        candidateProfileId: task.payload.candidateProfileId,
        reason: prepared.reason,
        msg: "Application task blocked before browser submission"
      }));
      return;
    }

    const candidateProfile = await this.candidateProfiles.getById(prepared.application.candidateProfileId);
    if (!candidateProfile) throw new Error(`Candidate profile '${prepared.application.candidateProfileId}' could not be loaded.`);

    let applicationProfile = candidateProfile;
    if (this.tailoredResumeArtifacts) {
      const artifact = await this.tailoredResumeArtifacts.create(prepared.application.jobTitle, prepared.application.jobDescription);
      if (this.tailoredResumeRepository) {
        await this.tailoredResumeRepository.save({
          applicationId: prepared.application.applicationId, jobOpportunityId: prepared.application.jobOpportunityId,
          candidateProfileId: prepared.application.candidateProfileId, jobTitle: prepared.application.jobTitle,
          sourceVersion: artifact.sourceVersion, resumePath: artifact.resumePath, atsScore: artifact.atsScore,
          matchedKeywords: artifact.matchedKeywords, missingKeywords: artifact.missingKeywords, warnings: artifact.warnings
        });
      }
      applicationProfile = { ...candidateProfile, resumePath: artifact.resumePath };
    }

    let outcome: ApplicationSubmissionOutcome;
    try {
      outcome = await this.submissions.submit({
        context: { jobOpportunityId: prepared.application.jobOpportunityId, candidateProfileId: prepared.application.candidateProfileId, applicationId: prepared.application.applicationId, url: prepared.application.url },
        companyName: prepared.application.companyName,
        excludedCompanies: this.excludedCompanies,
        candidateProfile: applicationProfile
      });
    } catch (error) {
      const reason = `Application submission failed: ${error instanceof Error ? error.message : String(error)}`;
      outcome = { submitted: false, safetyAllowed: false, reason, adapterName: "submission-error", result: null };
      console.error(JSON.stringify({
        level: 50,
        taskId: task.id,
        taskType: task.taskType,
        applicationId: prepared.application.applicationId,
        jobOpportunityId: prepared.application.jobOpportunityId,
        companyName: prepared.application.companyName,
        jobTitle: prepared.application.jobTitle,
        reason,
        msg: "Application submission threw"
      }));
    }

    console.log(JSON.stringify({
      level: 30,
      taskId: task.id,
      taskType: task.taskType,
      applicationId: prepared.application.applicationId,
      jobOpportunityId: prepared.application.jobOpportunityId,
      companyName: prepared.application.companyName,
      jobTitle: prepared.application.jobTitle,
      adapterName: outcome.adapterName,
      submitted: outcome.submitted,
      safetyAllowed: outcome.safetyAllowed,
      reason: outcome.reason,
      msg: "Application submission outcome"
    }));

    if (this.attemptRepository) {
      await this.attemptRepository.record({
        applicationId: prepared.application.applicationId, adapterName: outcome.adapterName ?? "unknown", safetyAllowed: outcome.safetyAllowed,
        submitted: outcome.submitted, reason: outcome.reason, confirmationUrl: outcome.result?.confirmationUrl ?? null,
        externalApplicationId: outcome.result?.externalApplicationId ?? null
      });
    }

    if (!this.emailDispatcher || !candidateProfile.email) return;
    const candidateName = candidateProfile.fullName ?? ([candidateProfile.firstName, candidateProfile.lastName].filter(Boolean).join(" ") || "Candidate");
    const context: ApplicationEmailContext = {
      recipient: candidateProfile.email, candidateName, jobTitle: prepared.application.jobTitle,
      companyName: prepared.application.companyName, applicationId: prepared.application.applicationId,
      confirmationUrl: outcome.result?.confirmationUrl, reason: outcome.submitted ? undefined : outcome.reason
    };
    if (outcome.submitted) await this.emailDispatcher.enqueueApplicationSubmitted(context);
    else await this.emailDispatcher.enqueueApplicationBlocked(context);
  }
}
