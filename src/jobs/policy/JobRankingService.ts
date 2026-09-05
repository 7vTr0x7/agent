import { JobOpportunity } from "../domain/JobOpportunity";
import {
  evaluateJobEligibility,
  JobEligibilityResult,
  JobSearchPolicy
} from "./JobEligibility";
import { rankJob, JobRankingResult } from "./JobRanking";
import { JobRankingRepository } from "./JobRankingRepository";

export interface RankJobOpportunityInput {
  job: JobOpportunity;
  candidateProfileId: string;
  deterministicMatchScore: number | null;
  semanticMatchScore: number | null;
  now?: Date;
}

export interface RankJobOpportunityResult {
  eligibility: JobEligibilityResult;
  ranking: JobRankingResult;
  persisted: boolean;
}

export class JobRankingService {
  constructor(
    private readonly policy: JobSearchPolicy,
    private readonly rankings: JobRankingRepository
  ) {}

  async rankAndPersist(
    input: RankJobOpportunityInput
  ): Promise<RankJobOpportunityResult> {
    const eligibility = evaluateJobEligibility(
      {
        companyName: input.job.companyName,
        location: input.job.location,
        country: input.job.country,
        workplaceType: input.job.workplaceType
      },
      this.policy
    );

    const ranking = rankJob(
      {
        eligibility,
        deterministicMatchScore: input.deterministicMatchScore,
        semanticMatchScore: input.semanticMatchScore,
        postedAt: input.job.postedAt,
        now: input.now
      },
      this.policy
    );

    if (eligibility.decision === "REJECT") {
      return {
        eligibility,
        ranking,
        persisted: false
      };
    }

    await this.rankings.save({
      jobOpportunityId: input.job.id,
      candidateProfileId: input.candidateProfileId,
      ranking
    });

    return {
      eligibility,
      ranking,
      persisted: true
    };
  }
}
