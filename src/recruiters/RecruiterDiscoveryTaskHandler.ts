import { ClaimedTask } from "../queue/TaskQueue";
import { DISCOVER_RECRUITERS_TASK, DiscoverRecruitersTaskPayload } from "./RecruiterDiscoveryTask";
import { PersistentRecruiterDiscoveryService } from "./PersistentRecruiterDiscoveryService";

export class RecruiterDiscoveryTaskHandler {
  constructor(
    private readonly discovery: PersistentRecruiterDiscoveryService,
    private readonly maxContacts: number,
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
    } catch (error) {
      // The application itself must never be failed because recruiter discovery failed.
      this.logger?.error(
        `[recruiter-discovery] ${task.payload.companyName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
