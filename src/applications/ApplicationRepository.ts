import { Database } from "../database/Database";

export interface PreparedApplication {
  applicationId: string;
  jobOpportunityId: string;
  candidateProfileId: string;
  url: string;
  companyName: string;
}

export type PrepareApplicationResult =
  | { prepared: true; application: PreparedApplication }
  | { prepared: false; reason: string };

export class ApplicationRepository {
  constructor(private readonly database: Database) {}

  async prepare(
    jobOpportunityId: string,
    candidateProfileId: string
  ): Promise<PrepareApplicationResult> {
    return this.database.transaction(async (client) => {
      const candidate = await client.query<{
        job_opportunity_id: string;
        match_decision: "APPLY" | "REJECT" | "REVIEW";
        opportunity_status: "ACTIVE" | "STALE" | "CLOSED";
        company_name: string;
        canonical_url: string;
        has_ranking: boolean;
        has_application: boolean;
        job_id: string | null;
      }>(
        `
          SELECT
            jo.id AS job_opportunity_id,
            md.decision AS match_decision,
            jo.status AS opportunity_status,
            jo.company_name,
            jo.canonical_url,
            EXISTS (
              SELECT 1
              FROM job_rankings jr
              WHERE jr.job_opportunity_id = jo.id
                AND jr.candidate_profile_id = md.candidate_profile_id
            ) AS has_ranking,
            EXISTS (
              SELECT 1
              FROM applications a
              WHERE a.job_opportunity_id = jo.id
            ) AS has_application,
            (
              SELECT j.id
              FROM jobs j
              WHERE j.job_opportunity_id = jo.id
              ORDER BY j.created_at ASC, j.id ASC
              LIMIT 1
            ) AS job_id
          FROM job_opportunities jo
          INNER JOIN match_decisions md
            ON md.job_opportunity_id = jo.id
           AND md.candidate_profile_id = $2
          WHERE jo.id = $1
          FOR UPDATE OF jo
        `,
        [jobOpportunityId, candidateProfileId]
      );

      const row = candidate.rows[0];
      if (!row) {
        return { prepared: false, reason: "No eligible match decision exists." };
      }

      if (row.match_decision !== "APPLY") {
        return { prepared: false, reason: "Match decision is not APPLY." };
      }

      if (row.opportunity_status !== "ACTIVE") {
        return { prepared: false, reason: "Job opportunity is not active." };
      }

      if (!row.has_ranking) {
        return { prepared: false, reason: "Job opportunity has no persisted ranking." };
      }

      if (row.has_application) {
        return { prepared: false, reason: "Application already exists for this opportunity." };
      }

      if (!row.job_id) {
        return { prepared: false, reason: "No legacy job record is linked to this opportunity." };
      }

      const inserted = await client.query<{ id: string }>(
        `
          INSERT INTO applications (
            job_id,
            job_opportunity_id,
            status
          )
          VALUES ($1, $2, 'READY')
          ON CONFLICT (job_opportunity_id) DO NOTHING
          RETURNING id
        `,
        [row.job_id, jobOpportunityId]
      );

      const application = inserted.rows[0];
      if (!application) {
        return { prepared: false, reason: "Application was already created concurrently." };
      }

      await client.query(
        `
          INSERT INTO application_events (
            application_id,
            from_status,
            to_status,
            event_type,
            metadata
          )
          VALUES ($1, NULL, 'READY', 'APPLICATION_PREPARED', $2::jsonb)
        `,
        [
          application.id,
          JSON.stringify({ jobOpportunityId, candidateProfileId })
        ]
      );

      return {
        prepared: true,
        application: {
          applicationId: application.id,
          jobOpportunityId,
          candidateProfileId,
          url: row.canonical_url,
          companyName: row.company_name
        }
      };
    });
  }
}
