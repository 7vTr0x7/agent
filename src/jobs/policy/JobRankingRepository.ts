import { Database } from "../../database/Database";
import { JobRankingResult } from "./JobRanking";

export interface PersistedJobRanking {
  jobOpportunityId: string;
  candidateProfileId: string;
  ranking: JobRankingResult;
}

export interface JobRankingRepository {
  save(ranking: PersistedJobRanking): Promise<void>;
}

export class PostgresJobRankingRepository implements JobRankingRepository {
  constructor(private readonly database: Database) {}

  async save(ranking: PersistedJobRanking): Promise<void> {
    await this.database.query(
      `
        INSERT INTO job_rankings (
          job_opportunity_id,
          candidate_profile_id,
          rank_score,
          tier,
          location_score,
          match_score,
          freshness_bonus,
          reason
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (job_opportunity_id, candidate_profile_id)
        DO UPDATE SET
          rank_score = EXCLUDED.rank_score,
          tier = EXCLUDED.tier,
          location_score = EXCLUDED.location_score,
          match_score = EXCLUDED.match_score,
          freshness_bonus = EXCLUDED.freshness_bonus,
          reason = EXCLUDED.reason,
          ranked_at = NOW(),
          updated_at = NOW()
      `,
      [
        ranking.jobOpportunityId,
        ranking.candidateProfileId,
        ranking.ranking.score,
        ranking.ranking.tier,
        ranking.ranking.locationScore,
        ranking.ranking.matchScore,
        ranking.ranking.freshnessBonus,
        ranking.ranking.reason
      ]
    );
  }
}
