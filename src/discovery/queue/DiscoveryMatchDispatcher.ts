import { JobOpportunityRepository } from "../../jobs/domain/JobOpportunityRepository";
import {
  evaluateJobEligibility,
  JobSearchPolicy
} from "../../jobs/policy/JobEligibility";
import { MatchTaskDispatcher } from "../../matching/MatchTask";

export interface DispatchMatchResult {
  enqueued: number;
  rejected: number;
  missing: number;
}

export class DiscoveryMatchDispatcher {
  constructor(
    private readonly opportunities: JobOpportunityRepository,
    private readonly matchTasks: MatchTaskDispatcher,
    private readonly policy: JobSearchPolicy,
    private readonly candidateProfileId: string
  ) {}

  async dispatch(opportunityIds: readonly string[]): Promise<DispatchMatchResult> {
    let enqueued = 0;
    let rejected = 0;
    let missing = 0;

    for (const opportunityId of opportunityIds) {
      const opportunity = await this.opportunities.findById(opportunityId);

      if (!opportunity) {
        missing++;
        continue;
      }

      const eligibility = evaluateJobEligibility(opportunity, this.policy);

      if (eligibility.decision === "REJECT") {
        rejected++;
        continue;
      }

      await this.matchTasks.enqueue(
        opportunity.id,
        this.candidateProfileId,
        priorityToQueuePriority(eligibility.priority)
      );
      enqueued++;
    }

    return { enqueued, rejected, missing };
  }
}

function priorityToQueuePriority(priority: 1 | 2 | 3 | null): number {
  if (priority === 1) return 30;
  if (priority === 2) return 20;
  return 10;
}
