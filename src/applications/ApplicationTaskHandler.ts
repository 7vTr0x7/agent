import { ClaimedTask } from "../queue/TaskQueue";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { APPLY_JOB_TASK, ApplyJobTaskPayload } from "./ApplicationTask";
import { ApplicationRepository } from "./ApplicationRepository";
import { ApplicationSubmissionService } from "./ApplicationSubmissionService";

export interface CandidateProfileResolver {
  getById(candidateProfileId: string): Promise<CandidateProfile | null>;
}

export class ApplicationTaskHandler {
  constructor(
    private readonly applications: Pick<ApplicationRepository, "prepare">,
    private readonly submissions: ApplicationSubmissionService,
    private readonly candidateProfiles: CandidateProfileResolver,
    private readonly excludedCompanies: readonly string[] = []
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

    await this.submissions.submit({
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
  }
}
