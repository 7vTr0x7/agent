import { Database } from "../database/Database";
import { evaluateApplicationPolicy } from "./ApplicationPolicy";
import { ApplicationRateLimitPolicy } from "./ApplicationRateLimitPolicy";
import { ApplicationCompanyRateLimitPolicy } from "./ApplicationCompanyRateLimitPolicy";

export interface PreparedApplication {
  applicationId: string;
  jobOpportunityId: string;
  candidateProfileId: string;
  url: string;
  jobTitle: string;
  companyName: string;
  jobDescription: string;
}

export type PrepareApplicationResult =
  | { prepared: true; application: PreparedApplication }
  | { prepared: false; reason: string };

export interface SubmittedApplicationResult {
  applicationId: string;
  confirmationUrl: string | null;
  externalApplicationId: string | null;
}

export interface StaleSubmission {
  applicationId: string;
  candidateProfileId: string;
  companyName: string;
  startedAt: Date;
}

export interface VerifiedSubmissionEvidence {
  confirmationUrl: string;
  externalApplicationId: string;
  verificationSource: "INDEPENDENT_CONFIRMATION";
}

export class ApplicationRepository {
  constructor(
    private readonly database: Database,
    private readonly excludedCompanies: readonly string[] = [],
    private readonly rateLimitPolicy = new ApplicationRateLimitPolicy({
      maxSubmissionsPerDay: 50
    }),
    private readonly companyRateLimitPolicy = new ApplicationCompanyRateLimitPolicy({
      maxSubmissionsPerCompanyPerDay: 5
    })
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
        job_description: string;
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
            jo.description AS job_description,
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
          companyName: row.company_name,
          jobDescription: row.job_description
        }
      };
    });
  }

  async beginSubmission(applicationId: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const current = await client.query<{
        status: string;
        candidate_profile_id: string;
        company_name: string;
      }>(
        `
          SELECT
            a.status,
            a.candidate_profile_id,
            jo.company_name
          FROM applications a
          INNER JOIN job_opportunities jo ON jo.id = a.job_opportunity_id
          WHERE a.id = $1
          FOR UPDATE OF a
        `,
        [applicationId]
      );

      const row = current.rows[0];
      if (!row || (row.status !== "READY" && row.status !== "DRAFTED")) {
        return false;
      }

      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [row.candidate_profile_id]
      );

      const globalCount = await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM applications a
          WHERE a.candidate_profile_id = $1
            AND (
              a.status = 'SUBMISSION_IN_PROGRESS'
              OR EXISTS (
                SELECT 1
                FROM application_attempts aa
                WHERE aa.application_id = a.id
                  AND aa.submitted = TRUE
                  AND aa.attempted_at >= CURRENT_DATE
              )
            )
        `,
        [row.candidate_profile_id]
      );

      const submissionsUsed = Number(globalCount.rows[0]?.count ?? "0");
      const globalLimit = this.rateLimitPolicy.evaluate(submissionsUsed);
      if (!globalLimit.allowed) {
        return false;
      }

      const companyCount = await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM applications a
          INNER JOIN job_opportunities jo ON jo.id = a.job_opportunity_id
          WHERE a.candidate_profile_id = $1
            AND LOWER(TRIM(jo.company_name)) = LOWER(TRIM($2))
            AND (
              a.status = 'SUBMISSION_IN_PROGRESS'
              OR EXISTS (
                SELECT 1
                FROM application_attempts aa
                WHERE aa.application_id = a.id
                  AND aa.submitted = TRUE
                  AND aa.attempted_at >= CURRENT_DATE
              )
            )
        `,
        [row.candidate_profile_id, row.company_name]
      );

      const companySubmissionsUsed = Number(companyCount.rows[0]?.count ?? "0");
      if (companySubmissionsUsed >= this.companyRateLimitPolicy.maxSubmissionsPerCompanyPerDay) {
        return false;
      }

      await client.query(
        `
          UPDATE applications
          SET status = 'SUBMISSION_IN_PROGRESS',
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
          VALUES ($1, $2, 'SUBMISSION_IN_PROGRESS', 'APPLICATION_SUBMISSION_STARTED', $3::jsonb)
        `,
        [
          applicationId,
          row.status,
          JSON.stringify({
            dailySubmissionsUsed: submissionsUsed,
            companySubmissionsUsed
          })
        ]
      );

      return true;
    });
  }

  async cancelSubmission(applicationId: string, reason: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const updated = await client.query<{ status: string }>(
        `
          UPDATE applications
          SET status = 'READY',
              updated_at = NOW()
          WHERE id = $1
            AND status = 'SUBMISSION_IN_PROGRESS'
          RETURNING status
        `,
        [applicationId]
      );

      if (!updated.rows[0]) {
        return false;
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
          VALUES ($1, 'SUBMISSION_IN_PROGRESS', 'READY', 'APPLICATION_SUBMISSION_NOT_CONFIRMED', $2::jsonb)
        `,
        [applicationId, JSON.stringify({ reason })]
      );

      return true;
    });
  }

  async listStaleSubmissions(olderThanMinutes: number): Promise<StaleSubmission[]> {
    if (!Number.isFinite(olderThanMinutes) || olderThanMinutes <= 0) {
      throw new Error("olderThanMinutes must be a positive finite number.");
    }

    const result = await this.database.query<{
      id: string;
      candidate_profile_id: string;
      company_name: string;
      updated_at: Date;
    }>(
      `
        SELECT
          a.id,
          a.candidate_profile_id,
          jo.company_name,
          a.updated_at
        FROM applications a
        INNER JOIN job_opportunities jo ON jo.id = a.job_opportunity_id
        WHERE a.status = 'SUBMISSION_IN_PROGRESS'
          AND a.updated_at < NOW() - ($1::int * INTERVAL '1 minute')
        ORDER BY a.updated_at ASC
      `,
      [Math.floor(olderThanMinutes)]
    );

    return result.rows.map((row) => ({
      applicationId: row.id,
      candidateProfileId: row.candidate_profile_id,
      companyName: row.company_name,
      startedAt: row.updated_at
    }));
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

      if (row.status !== "SUBMISSION_IN_PROGRESS") {
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

  async recoverVerifiedSubmission(
    applicationId: string,
    olderThanMinutes: number,
    evidence: VerifiedSubmissionEvidence
  ): Promise<SubmittedApplicationResult | null> {
    if (!Number.isFinite(olderThanMinutes) || olderThanMinutes <= 0) {
      throw new Error("olderThanMinutes must be a positive finite number.");
    }

    return this.database.transaction(async (client) => {
      const current = await client.query<{
        status: string;
        updated_at: Date;
      }>(
        `
          SELECT status, updated_at
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
          confirmationUrl: evidence.confirmationUrl,
          externalApplicationId: evidence.externalApplicationId
        };
      }

      if (row.status !== "SUBMISSION_IN_PROGRESS") {
        return null;
      }

      const staleResult = await client.query<{ stale: boolean }>(
        `
          SELECT updated_at < NOW() - ($2::int * INTERVAL '1 minute') AS stale
          FROM applications
          WHERE id = $1
        `,
        [applicationId, Math.floor(olderThanMinutes)]
      );

      if (!staleResult.rows[0]?.stale) {
        return null;
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
          VALUES ($1, 'SUBMISSION_IN_PROGRESS', 'SENT', 'APPLICATION_SUBMISSION_RECOVERED', $2::jsonb)
        `,
        [
          applicationId,
          JSON.stringify({
            confirmationUrl: evidence.confirmationUrl,
            externalApplicationId: evidence.externalApplicationId,
            verificationSource: evidence.verificationSource
          })
        ]
      );

      return {
        applicationId,
        confirmationUrl: evidence.confirmationUrl,
        externalApplicationId: evidence.externalApplicationId
      };
    });
  }
}
