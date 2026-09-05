import { Database } from "../database/Database";
import { ApplicationTaskDispatcher } from "./ApplicationTask";

interface CandidateApplicationRow {
  job_opportunity_id: string;
  candidate_profile_id: string;
  tier: number;
  rank_score: number;
}

export interface ApplicationQueueResult {
  queued: number;
}

export class ApplicationQueueService {
  constructor(
    private readonly database: Database,
    private readonly dispatcher: ApplicationTaskDispatcher
  ) {}

  async enqueueEligible(
    candidateProfileId: string,
    limit = 50
  ): Promise<ApplicationQueueResult> {
    const result = await this.database.query<CandidateApplicationRow>(
      `
        SELECT
          md.job_opportunity_id,
          md.candidate_profile_id,
          jr.tier,
          jr.rank_score
        FROM match_decisions md
        INNER JOIN job_rankings jr
          ON jr.job_opportunity_id = md.job_opportunity_id
         AND jr.candidate_profile_id = md.candidate_profile_id
        INNER JOIN job_opportunities jo
          ON jo.id = md.job_opportunity_id
        LEFT JOIN applications a
          ON a.job_opportunity_id = md.job_opportunity_id
        WHERE md.candidate_profile_id = $1
          AND md.decision = 'APPLY'
          AND jo.status = 'ACTIVE'
          AND a.id IS NULL
        ORDER BY
          jr.tier ASC,
          jr.rank_score DESC,
          jo.last_seen_at DESC
        LIMIT $2
      `,
      [candidateProfileId, limit]
    );

    for (const row of result.rows) {
      const priority = (4 - row.tier) * 1000 + row.rank_score;
      await this.dispatcher.enqueue(
        row.job_opportunity_id,
        row.candidate_profile_id,
        priority
      );
    }

    return { queued: result.rows.length };
  }
}
