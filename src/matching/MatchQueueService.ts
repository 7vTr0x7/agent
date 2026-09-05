import { Database } from "../database/Database";
import { MatchTaskDispatcher } from "./MatchTask";

interface JobIdRow {
  id: string;
}

export interface MatchQueueResult {
  queued: number;
}

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
          AND md.id IS NULL
        ORDER BY
          CASE
            WHEN LOWER(COALESCE(jo.location, '')) LIKE '%bangalore%'
              OR LOWER(COALESCE(jo.location, '')) LIKE '%bengaluru%' THEN 1
            WHEN LOWER(COALESCE(jo.country, '')) = 'india' THEN 2
            ELSE 3
          END,
          jo.last_seen_at DESC
        LIMIT $2
      `,
      [candidateProfileId, limit]
    );

    for (const row of result.rows) {
      await this.dispatcher.enqueue(row.id, candidateProfileId);
    }

    return { queued: result.rows.length };
  }
}
