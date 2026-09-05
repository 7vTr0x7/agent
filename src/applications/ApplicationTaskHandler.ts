import { ClaimedTask } from "../queue/TaskQueue";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { APPLY_JOB_TASK, ApplyJobTaskPayload } from "./ApplicationTask";
import { ApplicationRepository } from "./ApplicationRepository";
import { ApplicationSubmissionService } from "./ApplicationSubmissionService";
import { ApplicationEmailContext } from "../notifications/Email";

export interface CandidateProfileResolver {
  getById(candidateProfileId: string): Promise<CandidateProfile | null>;
}

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
    private readonly emailDispatcher?: ApplicationEmailDispatcher
  ) {}

  async handle(task: ClaimedTask<ApplyJobTaskPayload>): Promise<void> {
    if (task.taskType !== APPLY_JOB_TASK) {
      throw new Error(`Unsupported application task type: ${task.taskType}`);
    }

    const prepared = await this.applications.prepare(
      task.payload.jobOpportunityId,
      task.payload.candidateProfileId
    );

    if (!prepared.prepared) {
      return;
    }

    const candidateProfile = await this.candidateProfiles.getById(
      prepared.application.candidateProfileId
    );

    if (!candidateProfile) {
      throw new Error(
        `Candidate profile '${prepared.application.candidateProfileId}' could not be loaded.`
      );
    }

    const outcome = await this.submissions.submit({
      context: {
        jobOpportunityId: prepared.application.jobOpportunityId,
        candidateProfileId: prepared.application.candidateProfileId,
        applicationId: prepared.application.applicationId,
        url: prepared.application.url
      },
      companyName: prepared.application.companyName,
      excludedCompanies: this.excludedCompanies,
      candidateProfile
    });

    if (!this.emailDispatcher || !candidateProfile.email) {
      return;
    }

    const candidateName =
      candidateProfile.fullName ??
      ([candidateProfile.firstName, candidateProfile.lastName].filter(Boolean).join(" ") || "Candidate");

    const context: ApplicationEmailContext = {
      recipient: candidateProfile.email,
      candidateName,
      jobTitle: prepared.application.jobTitle,
      companyName: prepared.application.companyName,
      applicationId: prepared.application.applicationId,
      confirmationUrl: outcome.result?.confirmationUrl,
      reason: outcome.submitted ? undefined : outcome.reason
    };

    if (outcome.submitted) {
      await this.emailDispatcher.enqueueApplicationSubmitted(context);
    } else {
      await this.emailDispatcher.enqueueApplicationBlocked(context);
    }
  }
}
