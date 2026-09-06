import { Database } from "../database/Database";
import { ApplicationTaskDispatcher } from "./ApplicationTask";
import { ApplicationRateLimitPolicy } from "./ApplicationRateLimitPolicy";

interface CandidateApplicationRow {
  job_opportunity_id: string;
  candidate_profile_id: string;
  tier: number;
  rank_score: number;
}

interface SubmissionCountRow {
  count: string;
}

export interface ApplicationQueueResult {
  queued: number;
  rateLimited: boolean;
  submissionsUsed: number;
  submissionsRemaining: number;
}

export class ApplicationQueueService {
  constructor(
    private readonly database: Database,
    private readonly dispatcher: ApplicationTaskDispatcher,
    private readonly rateLimitPolicy = new ApplicationRateLimitPolicy({
      maxSubmissionsPerDay: 50
    })
  ) {}

  async enqueueEligible(
    candidateProfileId: string,
    limit = 50
  ): Promise<ApplicationQueueResult> {
    const countResult = await this.database.query<SubmissionCountRow>(
      `
        SELECT COUNT(*)::text AS count
        FROM application_attempts aa
        INNER JOIN applications a ON a.id = aa.application_id
        WHERE a.candidate_profile_id = $1
          AND aa.submitted = TRUE
          AND aa.attempted_at >= CURRENT_DATE
      `,
      [candidateProfileId]
    );

    const submissionsUsed = Number(countResult.rows[0]?.count ?? "0");
    const rateLimit = this.rateLimitPolicy.evaluate(submissionsUsed);

    if (!rateLimit.allowed) {
      return {
        queued: 0,
        rateLimited: true,
        submissionsUsed,
        submissionsRemaining: 0
      };
    }

    const effectiveLimit = Math.min(limit, rateLimit.remaining);
    if (effectiveLimit <= 0) {
      return {
        queued: 0,
        rateLimited: true,
        submissionsUsed,
        submissionsRemaining: 0
      };
    }

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
      [candidateProfileId, effectiveLimit]
    );

    for (const row of result.rows) {
      const priority = (4 - row.tier) * 1000 + row.rank_score;
      await this.dispatcher.enqueue(
        row.job_opportunity_id,
        row.candidate_profile_id,
        priority
      );
    }

    return {
      queued: result.rows.length,
      rateLimited: false,
      submissionsUsed,
      submissionsRemaining: Math.max(0, rateLimit.remaining - result.rows.length)
    };
  }
}
