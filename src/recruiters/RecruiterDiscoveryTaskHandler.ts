import { ClaimedTask } from "../queue/TaskQueue";
import { DISCOVER_RECRUITERS_TASK, DiscoverRecruitersTaskPayload } from "./RecruiterDiscoveryTask";
import { PersistentRecruiterDiscoveryService } from "./PersistentRecruiterDiscoveryService";
import { RecruiterOutreachPreparationTaskDispatcher } from "./RecruiterOutreachPreparationTask";

export class RecruiterDiscoveryTaskHandler {
  constructor(
    private readonly discovery: PersistentRecruiterDiscoveryService,
    private readonly maxContacts: number,
    private readonly preparationDispatcher?: RecruiterOutreachPreparationTaskDispatcher,
    private readonly logger?: Pick<Console, "error" | "info">
  ) {}

  async handle(task: ClaimedTask<DiscoverRecruitersTaskPayload>): Promise<void> {
    if (task.taskType !== DISCOVER_RECRUITERS_TASK) {
      throw new Error(`Unsupported recruiter discovery task type: ${task.taskType}`);
    }

    try {
      const result = await this.discovery.discoverAndPersist(
        {
          companyName: task.payload.companyName,
          companyDomain: task.payload.companyDomain,
          jobTitle: task.payload.jobTitle,
          jobDescription: task.payload.jobDescription,
          location: task.payload.location,
          candidateProfileId: task.payload.candidateProfileId,
          jobOpportunityId: task.payload.jobOpportunityId,
          applicationId: task.payload.applicationId
        },
        this.maxContacts
      );

      this.logger?.info(
        `[recruiter-discovery] ${task.payload.companyName}: ${result.status} - ${result.reason}`
      );

      if (
        this.preparationDispatcher &&
        result.status === "DISCOVERED" &&
        result.contacts.length > 0
      ) {
        await this.preparationDispatcher.enqueue({
          companyName: task.payload.companyName,
          companyDomain: task.payload.companyDomain,
          jobTitle: task.payload.jobTitle,
          jobDescription: task.payload.jobDescription,
          jobOpportunityId: task.payload.jobOpportunityId,
          applicationId: task.payload.applicationId,
          candidateProfileId: task.payload.candidateProfileId,
          candidateName: task.payload.candidateName ?? "Candidate",
          contacts: result.contacts
        });
      }
    } catch (error) {
      // The application itself must never be failed because recruiter discovery failed.
      this.logger?.error(
        `[recruiter-discovery] ${task.payload.companyName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
