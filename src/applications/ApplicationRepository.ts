import { Database } from "../database/Database";
import { evaluateApplicationPolicy } from "./ApplicationPolicy";

export interface PreparedApplication {
  applicationId: string;
  jobOpportunityId: string;
  candidateProfileId: string;
  url: string;
  jobTitle: string;
  companyName: string;
}

export type PrepareApplicationResult =
  | { prepared: true; application: PreparedApplication }
  | { prepared: false; reason: string };

export interface SubmittedApplicationResult {
  applicationId: string;
  confirmationUrl: string | null;
  externalApplicationId: string | null;
}

export class ApplicationRepository {
  constructor(
    private readonly database: Database,
    private readonly excludedCompanies: readonly string[] = []
  ) {}

  async prepare(
    jobOpportunityId: string,
    candidateProfileId: string
  ): Promise<PrepareApplicationResult> {
    return this.database.transaction(async (client) => {
      const candidate = await client.query<{
        job_opportunity_id: string;
        match_decision: "APPLY" | "REJECT" | "REVIEW";
        opportunity_status: "ACTIVE" | "STALE" | "CLOSED";
        job_title: string;
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
            jo.title AS job_title,
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

      const policy = evaluateApplicationPolicy({
        matchDecision: row.match_decision,
        opportunityStatus: row.opportunity_status,
        hasRanking: row.has_ranking,
        hasExistingApplication: row.has_application,
        companyName: row.company_name,
        excludedCompanies: this.excludedCompanies
      });

      if (policy.decision === "BLOCK") {
        return { prepared: false, reason: policy.reason };
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
          jobTitle: row.job_title,
          companyName: row.company_name
        }
      };
    });
  }

  async markSubmitted(
    applicationId: string,
    confirmationUrl: string | null,
    externalApplicationId: string | null
  ): Promise<SubmittedApplicationResult> {
    return this.database.transaction(async (client) => {
      const current = await client.query<{ status: string }>(
        `
          SELECT status
          FROM applications
          WHERE id = $1
          FOR UPDATE
        `,
        [applicationId]
      );

      const row = current.rows[0];
      if (!row) {
        throw new Error("Application does not exist.");
      }

      if (row.status === "SENT") {
        return {
          applicationId,
          confirmationUrl,
          externalApplicationId
        };
      }

      if (row.status !== "READY" && row.status !== "DRAFTED") {
        throw new Error(`Application cannot transition from status '${row.status}' to SENT.`);
      }

      await client.query(
        `
          UPDATE applications
          SET status = 'SENT',
              applied_at = COALESCE(applied_at, NOW()),
              updated_at = NOW()
          WHERE id = $1
        `,
        [applicationId]
      );

      await client.query(
        `
          INSERT INTO application_events (
            application_id,
            from_status,
            to_status,
            event_type,
            metadata
          )
          VALUES ($1, $2, 'SENT', 'APPLICATION_SUBMITTED', $3::jsonb)
        `,
        [
          applicationId,
          row.status,
          JSON.stringify({ confirmationUrl, externalApplicationId })
        ]
      );

      return {
        applicationId,
        confirmationUrl,
        externalApplicationId
      };
    });
  }
}
