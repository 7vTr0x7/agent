import { Database } from "../database/Database";
import { MatchTaskDispatcher } from "./MatchTask";

interface JobIdRow {
  id: string;
}

export interface MatchQueueResult {
  queued: number;
}

// Keep stale-decision detection in lock-step with MatchPipeline's persisted
// input hash. A version mismatch must requeue existing ACTIVE opportunities so
// matcher fixes are applied to already-ingested jobs, not only new jobs.
const CURRENT_MATCHER_VERSION = "matcher-v6";

export class MatchQueueService {
  constructor(
    private readonly database: Database,
    private readonly dispatcher: MatchTaskDispatcher
  ) {}

  async enqueueUnmatched(candidateProfileId: string, limit = 100): Promise<MatchQueueResult> {
    const result = await this.database.query<JobIdRow>(
      `
        SELECT jo.id
        FROM job_opportunities jo
        LEFT JOIN match_decisions md
          ON md.job_opportunity_id = jo.id
         AND md.candidate_profile_id = $1
        WHERE jo.status = 'ACTIVE'
          AND (md.id IS NULL OR md.input_hash IS NULL OR md.input_hash NOT LIKE $2)
        ORDER BY
          CASE
            WHEN LOWER(COALESCE(jo.location, '')) LIKE '%bangalore%'
              OR LOWER(COALESCE(jo.location, '')) LIKE '%bengaluru%' THEN 1
            WHEN LOWER(COALESCE(jo.country, '')) = 'india' THEN 2
            ELSE 3
          END,
          jo.last_seen_at DESC
        LIMIT $3
      `,
      [candidateProfileId, `${CURRENT_MATCHER_VERSION}:%`, limit]
    );

    for (const row of result.rows) {
      await this.dispatcher.enqueue(row.id, candidateProfileId);
    }

    return { queued: result.rows.length };
  }
}
