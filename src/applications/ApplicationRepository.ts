import { randomUUID } from "node:crypto";
import { Database } from "../database/Database";
import { ApplicationSubmissionOutcome, NormalizedApplicationSubmissionResult } from "./ApplicationAdapter";
import { evaluateApplicationPolicy, PERMANENTLY_EXCLUDED_COMPANIES } from "./ApplicationPolicy";
import { ApplicationRateLimitPolicy } from "./ApplicationRateLimitPolicy";
import { ApplicationCompanyRateLimitPolicy } from "./ApplicationCompanyRateLimitPolicy";

export interface PreparedApplication { applicationId: string; jobOpportunityId: string; candidateProfileId: string; url: string; jobTitle: string; companyName: string; companyDomain?: string | null; jobDescription: string; }
export type PrepareApplicationResult = { prepared: true; application: PreparedApplication } | { prepared: false; reason: string };
export interface SubmittedApplicationResult { applicationId: string; confirmationUrl: string | null; externalApplicationId: string | null; }
export interface SubmissionReservation { attemptId: string; idempotencyKey: string; }
export interface StaleSubmission { applicationId: string; candidateProfileId: string; companyName: string; targetUrl: string; startedAt: Date; }
export interface StaleSubmissionEvidence extends StaleSubmission {
  attemptId: string | null; attemptOutcome: ApplicationSubmissionOutcome | null; attemptPhase: string | null;
  idempotencyKey: string | null; taskId: string | null; taskStatus: string | null; taskLeaseExpiresAt: Date | null;
  confirmationUrl: string | null; externalApplicationId: string | null; finalUrl: string | null; responseStatus: number | null;
  requestSentAt: Date | null; responseReceivedAt: Date | null; confirmationAttemptedAt: Date | null; confirmationReceivedAt: Date | null;
  ambiguityReason: string | null; metadata: Record<string, unknown> | null;
}
export interface VerifiedSubmissionEvidence { confirmationUrl: string; externalApplicationId: string; verificationSource: "INDEPENDENT_CONFIRMATION"; }
export interface StaleReconciliationResult { inspected: number; confirmedSuccess: number; definitiveFailure: number; safeToRetry: number; markedUnknown: number; unchangedActive: number; }

export class ApplicationRepository {
  constructor(
    private readonly database: Database,
    private readonly excludedCompanies: readonly string[] = PERMANENTLY_EXCLUDED_COMPANIES,
    private readonly rateLimitPolicy = new ApplicationRateLimitPolicy({ maxSubmissionsPerDay: 200 }),
    private readonly companyRateLimitPolicy = new ApplicationCompanyRateLimitPolicy({ maxSubmissionsPerCompanyPerDay: 20 })
  ) {}

  async prepare(jobOpportunityId: string, candidateProfileId: string): Promise<PrepareApplicationResult> {
    return this.database.transaction(async (client) => {
      const candidate = await client.query<{
        job_opportunity_id: string; match_decision: "APPLY" | "REJECT" | "REVIEW"; opportunity_status: "ACTIVE" | "STALE" | "CLOSED";
        job_title: string; company_name: string; company_domain: string | null; canonical_url: string; job_description: string;
        posted_at: Date | null; updated_at: Date | null; has_ranking: boolean; has_application: boolean;
        existing_application_id: string | null; existing_application_status: string | null; job_id: string | null;
      }>(
        `SELECT jo.id AS job_opportunity_id, md.decision AS match_decision, jo.status AS opportunity_status,
                jo.title AS job_title, jo.company_name, jo.company_domain, jo.canonical_url,
                jo.description AS job_description, jo.posted_at, jo.updated_at,
                EXISTS (SELECT 1 FROM job_rankings jr WHERE jr.job_opportunity_id = jo.id AND jr.candidate_profile_id = md.candidate_profile_id) AS has_ranking,
                existing_application.id AS existing_application_id, existing_application.status AS existing_application_status,
                (existing_application.id IS NOT NULL) AS has_application,
                (SELECT j.id FROM jobs j WHERE j.job_opportunity_id = jo.id ORDER BY j.created_at ASC, j.id ASC LIMIT 1) AS job_id
         FROM job_opportunities jo
         INNER JOIN match_decisions md ON md.job_opportunity_id = jo.id AND md.candidate_profile_id = $2
         LEFT JOIN LATERAL (SELECT a.id, a.status FROM applications a WHERE a.job_opportunity_id = jo.id ORDER BY a.created_at ASC, a.id ASC LIMIT 1) existing_application ON TRUE
         WHERE jo.id = $1 FOR UPDATE OF jo`,
        [jobOpportunityId, candidateProfileId]
      );
      const row = candidate.rows[0];
      if (!row) return { prepared: false, reason: "No eligible match decision exists." };
      const reusableExistingApplication = row.existing_application_id !== null && ["READY", "DRAFTED"].includes(row.existing_application_status ?? "");
      const policy = evaluateApplicationPolicy({
        matchDecision: row.match_decision, opportunityStatus: row.opportunity_status, hasRanking: row.has_ranking,
        hasExistingApplication: row.has_application && !reusableExistingApplication, companyName: row.company_name, excludedCompanies: this.excludedCompanies
      });
      if (policy.decision === "BLOCK") return { prepared: false, reason: policy.reason };

      let jobId = row.job_id;
      if (!jobId) {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [`materialize-job:${jobOpportunityId}`]);
        const existing = await client.query<{ id: string }>(`SELECT id FROM jobs WHERE job_opportunity_id = $1::uuid ORDER BY created_at ASC, id ASC LIMIT 1`, [jobOpportunityId]);
        jobId = existing.rows[0]?.id ?? null;
        if (!jobId) {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO jobs (source, source_job_id, url, title, company_name, location, country, workplace_type, employment_type, description, posted_at, discovered_at, content_hash, created_at, updated_at, job_opportunity_id)
             VALUES ('opportunity-materialized', $1::text, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, COALESCE($11::timestamptz, NOW()), encode(digest($2 || ':' || $1::text, 'sha256'), 'hex'), COALESCE($12::timestamptz, NOW()), COALESCE($13::timestamptz, $12::timestamptz, NOW()), $1::uuid)
             ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
            [jobOpportunityId, row.canonical_url, row.job_title, row.company_name, null, null, null, null, row.job_description, row.posted_at, row.updated_at, row.updated_at, row.updated_at]
          );
          jobId = inserted.rows[0]?.id ?? null;
        }
        if (!jobId) {
          const recovered = await client.query<{ id: string }>(`SELECT id FROM jobs WHERE job_opportunity_id = $1::uuid OR regexp_replace(trim(url), '[?#].*$', '') = $2 ORDER BY CASE WHEN job_opportunity_id = $1::uuid THEN 0 ELSE 1 END, created_at ASC, id ASC LIMIT 1`, [jobOpportunityId, row.canonical_url]);
          jobId = recovered.rows[0]?.id ?? null;
          if (jobId) await client.query(`UPDATE jobs SET job_opportunity_id = $1::uuid WHERE id = $2`, [jobOpportunityId, jobId]);
        }
      }
      if (!jobId) return { prepared: false, reason: "Unable to materialize a legacy job record for this opportunity." };

      if (reusableExistingApplication && row.existing_application_id) {
        return { prepared: true, application: { applicationId: row.existing_application_id, jobOpportunityId, candidateProfileId, url: row.canonical_url, jobTitle: row.job_title, companyName: row.company_name, companyDomain: row.company_domain, jobDescription: row.job_description } };
      }

      const inserted = await client.query<{ id: string }>(`INSERT INTO applications (job_id, job_opportunity_id, candidate_profile_id, status) VALUES ($1, $2, $3, 'READY') ON CONFLICT (job_opportunity_id) DO NOTHING RETURNING id`, [jobId, jobOpportunityId, candidateProfileId]);
      const application = inserted.rows[0];
      if (!application) return { prepared: false, reason: "Application was already created concurrently." };
      await client.query(`INSERT INTO application_events (application_id, from_status, to_status, event_type, metadata) VALUES ($1, NULL, 'READY', 'APPLICATION_PREPARED', $2::jsonb)`, [application.id, JSON.stringify({ jobOpportunityId, candidateProfileId })]);
      return { prepared: true, application: { applicationId: application.id, jobOpportunityId, candidateProfileId, url: row.canonical_url, jobTitle: row.job_title, companyName: row.company_name, companyDomain: row.company_domain, jobDescription: row.job_description } };
    });
  }

  async isTaskOwned(taskId: string, workerId: string): Promise<boolean> {
    const result = await this.database.query(`SELECT 1 FROM tasks WHERE id = $1 AND status = 'RUNNING' AND locked_by = $2 AND lease_expires_at > NOW() LIMIT 1`, [taskId, workerId]);
    return result.rows.length === 1;
  }

  async beginSubmissionAttempt(applicationId: string, taskId: string | null = null, workerId: string | null = null, targetUrl: string | null = null): Promise<SubmissionReservation | null> {
    return this.database.transaction(async (client) => {
      const current = await client.query<{ status: string; candidate_profile_id: string; company_name: string }>(`SELECT a.status, a.candidate_profile_id, jo.company_name FROM applications a INNER JOIN job_opportunities jo ON jo.id = a.job_opportunity_id WHERE a.id = $1 FOR UPDATE OF a`, [applicationId]);
      const row = current.rows[0];
      if (!row || !["READY", "DRAFTED"].includes(row.status)) return null;
      const companyKey = row.company_name.trim().toLowerCase();
      if ([...PERMANENTLY_EXCLUDED_COMPANIES, ...this.excludedCompanies].some((name) => name.trim().toLowerCase() === companyKey)) return null;
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [row.candidate_profile_id]);
      const submissionCount = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM applications a WHERE a.candidate_profile_id = $1 AND (a.status = 'SUBMISSION_IN_PROGRESS' OR (a.status = 'SENT' AND a.applied_at >= CURRENT_DATE) OR EXISTS (SELECT 1 FROM application_attempts aa WHERE aa.application_id = a.id AND aa.submitted = TRUE AND aa.attempted_at >= CURRENT_DATE))`, [row.candidate_profile_id]);
      const submissionsUsed = Number(submissionCount.rows[0]?.count ?? "0");
      if (!this.rateLimitPolicy.evaluate(submissionsUsed).allowed) return null;
      const companyCount = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM applications a INNER JOIN job_opportunities jo ON jo.id = a.job_opportunity_id WHERE a.candidate_profile_id = $1 AND LOWER(TRIM(jo.company_name)) = LOWER(TRIM($2)) AND (a.status = 'SUBMISSION_IN_PROGRESS' OR (a.status = 'SENT' AND a.applied_at >= CURRENT_DATE) OR EXISTS (SELECT 1 FROM application_attempts aa WHERE aa.application_id = a.id AND aa.submitted = TRUE AND aa.attempted_at >= CURRENT_DATE))`, [row.candidate_profile_id, row.company_name]);
      const companySubmissionsUsed = Number(companyCount.rows[0]?.count ?? "0");
      if (companySubmissionsUsed >= this.companyRateLimitPolicy.maxSubmissionsPerCompanyPerDay) return null;
      const idempotencyKey = `application-submit:${applicationId}:${randomUUID()}`;
      await client.query(`UPDATE applications SET status = 'SUBMISSION_IN_PROGRESS', updated_at = NOW() WHERE id = $1`, [applicationId]);
      const attempt = await client.query<{ id: string }>(`INSERT INTO application_attempts (application_id, adapter_name, safety_allowed, submitted, reason, confirmation_url, external_application_id, attempted_at, outcome, phase, idempotency_key, task_id, worker_id, target_url, metadata, updated_at) VALUES ($1, NULL, TRUE, FALSE, 'Submission attempt reserved before external action.', NULL, NULL, NOW(), NULL, 'RESERVED', $2, $3, $4, $5, $6::jsonb, NOW()) RETURNING id`, [applicationId, idempotencyKey, taskId, workerId, targetUrl, JSON.stringify({ dailySubmissionsUsed: submissionsUsed, companySubmissionsUsed })]);
      const attemptId = attempt.rows[0]?.id;
      if (!attemptId) throw new Error("Application submission attempt could not be created.");
      await client.query(`INSERT INTO application_events (application_id, from_status, to_status, event_type, metadata) VALUES ($1, $2, 'SUBMISSION_IN_PROGRESS', 'APPLICATION_SUBMISSION_STARTED', $3::jsonb)`, [applicationId, row.status, JSON.stringify({ attemptId, idempotencyKey, taskId, workerId, dailySubmissionsUsed: submissionsUsed, companySubmissionsUsed })]);
      return { attemptId, idempotencyKey };
    });
  }

  async beginSubmission(applicationId: string): Promise<boolean> { return Boolean(await this.beginSubmissionAttempt(applicationId)); }

  async updateSubmissionAttemptPhase(attemptId: string, phase: "RESERVED" | "EXECUTING" | "REQUEST_OBSERVED" | "CONFIRMING" | "FINALIZED", patch: { submissionStartedAt?: Date | null; requestSentAt?: Date | null; responseReceivedAt?: Date | null; confirmationAttemptedAt?: Date | null; confirmationReceivedAt?: Date | null; responseStatus?: number | null; finalUrl?: string | null; ambiguityReason?: string | null; metadata?: Record<string, unknown> | null } = {}): Promise<boolean> {
    const result = await this.database.query(`UPDATE application_attempts SET phase = $2, submission_started_at = COALESCE($3::timestamptz, submission_started_at), request_sent_at = COALESCE($4::timestamptz, request_sent_at), response_received_at = COALESCE($5::timestamptz, response_received_at), confirmation_attempted_at = COALESCE($6::timestamptz, confirmation_attempted_at), confirmation_received_at = COALESCE($7::timestamptz, confirmation_received_at), response_status = COALESCE($8::integer, response_status), final_url = COALESCE($9::text, final_url), ambiguity_reason = COALESCE($10::text, ambiguity_reason), metadata = CASE WHEN $11::jsonb IS NULL THEN metadata ELSE COALESCE(metadata, '{}'::jsonb) || $11::jsonb END, updated_at = NOW() WHERE id = $1 AND phase IS DISTINCT FROM 'FINALIZED'`, [attemptId, phase, patch.submissionStartedAt ?? null, patch.requestSentAt ?? null, patch.responseReceivedAt ?? null, patch.confirmationAttemptedAt ?? null, patch.confirmationReceivedAt ?? null, patch.responseStatus ?? null, patch.finalUrl ?? null, patch.ambiguityReason ?? null, patch.metadata ? JSON.stringify(patch.metadata) : null]);
    return result.rowCount === 1;
  }

  async finalizeSubmissionAttempt(applicationId: string, attemptId: string, adapterName: string, result: NormalizedApplicationSubmissionResult): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const current = await client.query<{ status: string }>(`SELECT status FROM applications WHERE id = $1 FOR UPDATE`, [applicationId]);
      if (current.rows[0]?.status !== "SUBMISSION_IN_PROGRESS") return false;
      const attempt = await client.query<{ id: string; application_id: string; phase: string | null }>(`SELECT id, application_id, phase FROM application_attempts WHERE id = $1 FOR UPDATE`, [attemptId]);
      const storedAttempt = attempt.rows[0];
      if (!storedAttempt || storedAttempt.application_id !== applicationId || storedAttempt.phase === "FINALIZED") return false;
      const outcome = result.outcome;
      const confirmed = outcome === "CONFIRMED_SUCCESS";
      if (confirmed && !result.confirmationUrl?.trim() && !result.externalApplicationId?.trim()) throw new Error("Confirmed application outcome requires confirmation evidence.");
      const nextStatus = outcome === "CONFIRMED_SUCCESS" ? "SENT" : outcome === "DEFINITIVE_FAILURE" ? "SUBMISSION_FAILED" : outcome === "NOT_SUBMITTED" ? "READY" : "SUBMISSION_UNKNOWN";
      const eventType = outcome === "CONFIRMED_SUCCESS" ? "APPLICATION_SUBMITTED" : outcome === "DEFINITIVE_FAILURE" ? "APPLICATION_SUBMISSION_FAILED" : outcome === "NOT_SUBMITTED" ? "APPLICATION_SUBMISSION_NOT_SUBMITTED" : "APPLICATION_SUBMISSION_AMBIGUOUS";
      await client.query(`UPDATE application_attempts SET adapter_name = $2, safety_allowed = TRUE, submitted = $3, reason = $4, confirmation_url = $5, external_application_id = $6, outcome = $7, phase = 'FINALIZED', final_url = $8, response_status = $9, request_sent_at = $10, response_received_at = $11, confirmation_attempted_at = $12, confirmation_received_at = $13, ambiguity_reason = $14, metadata = COALESCE(metadata, '{}'::jsonb) || $15::jsonb, updated_at = NOW() WHERE id = $1`, [attemptId, adapterName, confirmed, result.reason, result.confirmationUrl, result.externalApplicationId, outcome, result.evidence.finalUrl, result.evidence.responseStatus, result.evidence.requestSentAt, result.evidence.responseReceivedAt, new Date(), confirmed ? new Date() : null, outcome === "AMBIGUOUS" ? result.reason : null, JSON.stringify({ requestObserved: result.evidence.requestObserved, responseObserved: result.evidence.responseObserved, outcome })]);
      await client.query(`UPDATE applications SET status = $2, applied_at = CASE WHEN $2 = 'SENT' THEN NOW() ELSE applied_at END, updated_at = NOW() WHERE id = $1`, [applicationId, nextStatus]);
      await client.query(`INSERT INTO application_events (application_id, from_status, to_status, event_type, metadata) VALUES ($1, 'SUBMISSION_IN_PROGRESS', $2, $3, $4::jsonb)`, [applicationId, nextStatus, eventType, JSON.stringify({ attemptId, adapterName, outcome, reason: result.reason, confirmationUrl: result.confirmationUrl, externalApplicationId: result.externalApplicationId, evidence: { requestObserved: result.evidence.requestObserved, responseObserved: result.evidence.responseObserved, responseStatus: result.evidence.responseStatus, finalUrl: result.evidence.finalUrl } })]);
      return true;
    });
  }

  async cancelSubmission(applicationId: string, reason: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const updated = await client.query<{ status: string }>(`UPDATE applications SET status = 'READY', updated_at = NOW() WHERE id = $1 AND status = 'SUBMISSION_IN_PROGRESS' RETURNING status`, [applicationId]);
      if (!updated.rows[0]) return false;
      await client.query(`INSERT INTO application_events (application_id, from_status, to_status, event_type, metadata) VALUES ($1, 'SUBMISSION_IN_PROGRESS', 'READY', 'APPLICATION_SUBMISSION_NOT_CONFIRMED', $2::jsonb)`, [applicationId, JSON.stringify({ reason })]);
      return true;
    });
  }

  async listStaleSubmissions(olderThanMinutes: number): Promise<StaleSubmission[]> {
    if (!Number.isFinite(olderThanMinutes) || olderThanMinutes <= 0) throw new Error("olderThanMinutes must be a positive finite number.");
    const result = await this.database.query<{ id: string; candidate_profile_id: string; company_name: string; target_url: string; updated_at: Date }>(`SELECT a.id, a.candidate_profile_id, jo.company_name, jo.canonical_url AS target_url, a.updated_at FROM applications a INNER JOIN job_opportunities jo ON jo.id = a.job_opportunity_id WHERE a.status = 'SUBMISSION_IN_PROGRESS' AND a.updated_at < NOW() - ($1 * INTERVAL '1 minute') ORDER BY a.updated_at ASC, a.id ASC`, [olderThanMinutes]);
    return result.rows.map((row) => ({ applicationId: row.id, candidateProfileId: row.candidate_profile_id, companyName: row.company_name, targetUrl: row.target_url, startedAt: row.updated_at }));
  }

  async listStaleSubmissionEvidence(olderThanMinutes: number): Promise<StaleSubmissionEvidence[]> {
    if (!Number.isFinite(olderThanMinutes) || olderThanMinutes <= 0) throw new Error("olderThanMinutes must be a positive finite number.");
    const result = await this.database.query<StaleSubmissionEvidenceRow>(`SELECT a.id, a.candidate_profile_id, jo.company_name, jo.canonical_url AS target_url, a.updated_at, aa.id AS attempt_id, aa.outcome AS attempt_outcome, aa.phase AS attempt_phase, aa.idempotency_key, aa.task_id, t.status AS task_status, t.lease_expires_at AS task_lease_expires_at, aa.confirmation_url, aa.external_application_id, aa.final_url, aa.response_status, aa.request_sent_at, aa.response_received_at, aa.confirmation_attempted_at, aa.confirmation_received_at, aa.ambiguity_reason, aa.metadata FROM applications a INNER JOIN job_opportunities jo ON jo.id = a.job_opportunity_id LEFT JOIN LATERAL (SELECT * FROM application_attempts aa0 WHERE aa0.application_id = a.id ORDER BY aa0.attempted_at DESC, aa0.id DESC LIMIT 1) aa ON TRUE LEFT JOIN tasks t ON t.id = aa.task_id WHERE a.status = 'SUBMISSION_IN_PROGRESS' AND a.updated_at < NOW() - ($1 * INTERVAL '1 minute') ORDER BY a.updated_at ASC, a.id ASC`, [olderThanMinutes]);
    return result.rows.map((row) => ({ applicationId: row.id, candidateProfileId: row.candidate_profile_id, companyName: row.company_name, targetUrl: row.target_url, startedAt: row.updated_at, attemptId: row.attempt_id, attemptOutcome: row.attempt_outcome, attemptPhase: row.attempt_phase, idempotencyKey: row.idempotency_key, taskId: row.task_id, taskStatus: row.task_status, taskLeaseExpiresAt: row.task_lease_expires_at, confirmationUrl: row.confirmation_url, externalApplicationId: row.external_application_id, finalUrl: row.final_url, responseStatus: row.response_status, requestSentAt: row.request_sent_at, responseReceivedAt: row.response_received_at, confirmationAttemptedAt: row.confirmation_attempted_at, confirmationReceivedAt: row.confirmation_received_at, ambiguityReason: row.ambiguity_reason, metadata: row.metadata }));
  }

  async reconcileStaleSubmissions(olderThanMinutes: number): Promise<StaleReconciliationResult> {
    const stale = await this.listStaleSubmissionEvidence(olderThanMinutes);
    const result: StaleReconciliationResult = { inspected: stale.length, confirmedSuccess: 0, definitiveFailure: 0, safeToRetry: 0, markedUnknown: 0, unchangedActive: 0 };
    for (const submission of stale) {
      const activeTask = submission.taskStatus === "RUNNING" && submission.taskLeaseExpiresAt !== null && submission.taskLeaseExpiresAt.getTime() > Date.now();
      if (activeTask) { result.unchangedActive += 1; continue; }
      if (submission.attemptOutcome === "CONFIRMED_SUCCESS") { if (await this.resolvePersistedAttemptOutcome(submission.applicationId, submission.attemptId, "CONFIRMED_SUCCESS")) result.confirmedSuccess += 1; continue; }
      if (submission.attemptOutcome === "DEFINITIVE_FAILURE") { if (await this.resolvePersistedAttemptOutcome(submission.applicationId, submission.attemptId, "DEFINITIVE_FAILURE", submission.ambiguityReason ?? "Adapter reported a definitive submission failure.")) result.definitiveFailure += 1; continue; }
      if (submission.attemptOutcome === "NOT_SUBMITTED" && submission.attemptPhase === "FINALIZED") { if (await this.resolvePersistedAttemptOutcome(submission.applicationId, submission.attemptId, "NOT_SUBMITTED")) result.safeToRetry += 1; continue; }
      if (submission.attemptOutcome === null && submission.attemptPhase === "RESERVED") { if (await this.resolvePersistedAttemptOutcome(submission.applicationId, submission.attemptId, "NOT_SUBMITTED", "Task ended before the submission attempt entered external execution; safe to retry.")) result.safeToRetry += 1; continue; }
      if (await this.markSubmissionUnknown(submission.applicationId, submission.attemptId, submission.ambiguityReason ?? "Submission attempt became stale without definitive external confirmation; reconciliation is required and resubmission is blocked.")) result.markedUnknown += 1;
    }
    return result;
  }

  private async resolvePersistedAttemptOutcome(applicationId: string, attemptId: string | null, outcome: "CONFIRMED_SUCCESS" | "DEFINITIVE_FAILURE" | "NOT_SUBMITTED", reason?: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const current = await client.query<{ status: string }>(`SELECT status FROM applications WHERE id = $1 FOR UPDATE`, [applicationId]);
      if (current.rows[0]?.status !== "SUBMISSION_IN_PROGRESS") return false;
      const nextStatus = outcome === "CONFIRMED_SUCCESS" ? "SENT" : outcome === "DEFINITIVE_FAILURE" ? "SUBMISSION_FAILED" : "READY";
      if (attemptId) await client.query(`UPDATE application_attempts SET outcome = $2, submitted = ($2 = 'CONFIRMED_SUCCESS'), phase = 'FINALIZED', reason = COALESCE($3, reason), updated_at = NOW() WHERE id = $1`, [attemptId, outcome, reason ?? null]);
      await client.query(`UPDATE applications SET status = $2, applied_at = CASE WHEN $2 = 'SENT' THEN COALESCE(applied_at, NOW()) ELSE applied_at END, updated_at = NOW() WHERE id = $1`, [applicationId, nextStatus]);
      await client.query(`INSERT INTO application_events (application_id, from_status, to_status, event_type, metadata) VALUES ($1, 'SUBMISSION_IN_PROGRESS', $2, $3, $4::jsonb)`, [applicationId, nextStatus, outcome === "CONFIRMED_SUCCESS" ? "APPLICATION_SUBMISSION_RECONCILED_SUCCESS" : outcome === "DEFINITIVE_FAILURE" ? "APPLICATION_SUBMISSION_RECONCILED_FAILURE" : "APPLICATION_SUBMISSION_RECONCILED_NOT_SUBMITTED", JSON.stringify({ attemptId, outcome, reason: reason ?? null })]);
      return true;
    });
  }

  private async markSubmissionUnknown(applicationId: string, attemptId: string | null, reason: string): Promise<boolean> {
    return this.database.transaction(async (client) => {
      const current = await client.query<{ status: string }>(`SELECT status FROM applications WHERE id = $1 FOR UPDATE`, [applicationId]);
      if (current.rows[0]?.status !== "SUBMISSION_IN_PROGRESS") return false;
      if (attemptId) await client.query(`UPDATE application_attempts SET outcome = 'AMBIGUOUS', submitted = FALSE, phase = 'FINALIZED', ambiguity_reason = $2, reason = $2, updated_at = NOW() WHERE id = $1`, [attemptId, reason]);
      await client.query(`UPDATE applications SET status = 'SUBMISSION_UNKNOWN', updated_at = NOW() WHERE id = $1`, [applicationId]);
      await client.query(`INSERT INTO application_events (application_id, from_status, to_status, event_type, metadata) VALUES ($1, 'SUBMISSION_IN_PROGRESS', 'SUBMISSION_UNKNOWN', 'APPLICATION_SUBMISSION_RECONCILIATION_REQUIRED', $2::jsonb)`, [applicationId, JSON.stringify({ attemptId, reason, resubmissionBlocked: true })]);
      return true;
    });
  }

  async markSubmitted(applicationId: string, confirmationUrl: string | null, externalApplicationId: string | null): Promise<SubmittedApplicationResult> {
    return this.database.transaction(async (client) => {
      const current = await client.query<{ status: string }>(`SELECT status FROM applications WHERE id = $1 FOR UPDATE`, [applicationId]);
      const row = current.rows[0];
      if (!row) throw new Error(`Application '${applicationId}' was not found.`);
      if (row.status === "SENT") return { applicationId, confirmationUrl, externalApplicationId };
      if (row.status !== "SUBMISSION_IN_PROGRESS") throw new Error(`Application cannot transition from status '${row.status}' to SENT.`);
      if (!confirmationUrl?.trim() && !externalApplicationId?.trim()) throw new Error("Application submission requires confirmation evidence.");
      await client.query(`UPDATE applications SET status = 'SENT', applied_at = NOW(), updated_at = NOW() WHERE id = $1`, [applicationId]);
      await client.query(`INSERT INTO application_events (application_id, from_status, to_status, event_type, metadata) VALUES ($1, 'SUBMISSION_IN_PROGRESS', 'SENT', 'APPLICATION_SUBMITTED', $2::jsonb)`, [applicationId, JSON.stringify({ confirmationUrl, externalApplicationId })]);
      return { applicationId, confirmationUrl, externalApplicationId };
    });
  }

  async recoverVerifiedSubmission(applicationId: string, olderThanMinutes: number, evidence: VerifiedSubmissionEvidence): Promise<SubmittedApplicationResult | null> {
    if (!Number.isFinite(olderThanMinutes) || olderThanMinutes <= 0) throw new Error("olderThanMinutes must be a positive finite number.");
    if (!evidence.confirmationUrl.trim() && !evidence.externalApplicationId.trim()) throw new Error("Verified submission evidence requires a confirmation URL or external application ID.");
    if (evidence.verificationSource !== "INDEPENDENT_CONFIRMATION") throw new Error("Verified submission evidence must come from independent confirmation.");
    return this.database.transaction(async (client) => {
      const current = await client.query<{ status: string; updated_at: Date }>(`SELECT status, updated_at FROM applications WHERE id = $1 FOR UPDATE`, [applicationId]);
      const row = current.rows[0];
      if (!row) return null;
      if (row.status === "SENT") return { applicationId, confirmationUrl: evidence.confirmationUrl, externalApplicationId: evidence.externalApplicationId };
      if (row.status === "SUBMISSION_IN_PROGRESS") {
        const stale = await client.query<{ stale: boolean }>(`SELECT updated_at < NOW() - ($2 * INTERVAL '1 minute') AS stale FROM applications WHERE id = $1`, [applicationId, olderThanMinutes]);
        if (!stale.rows[0]?.stale) return null;
      } else if (row.status !== "SUBMISSION_UNKNOWN") return null;
      const latestAttempt = await client.query<{ id: string }>(`SELECT id FROM application_attempts WHERE application_id = $1 ORDER BY attempted_at DESC, id DESC LIMIT 1`, [applicationId]);
      const attemptId = latestAttempt.rows[0]?.id ?? null;
      if (attemptId) await client.query(`UPDATE application_attempts SET outcome = 'CONFIRMED_SUCCESS', submitted = TRUE, phase = 'FINALIZED', confirmation_url = $2, external_application_id = $3, confirmation_received_at = NOW(), updated_at = NOW() WHERE id = $1`, [attemptId, evidence.confirmationUrl, evidence.externalApplicationId]);
      const fromStatus = row.status;
      await client.query(`UPDATE applications SET status = 'SENT', applied_at = NOW(), updated_at = NOW() WHERE id = $1`, [applicationId]);
      await client.query(`INSERT INTO application_events (application_id, from_status, to_status, event_type, metadata) VALUES ($1, $2, 'SENT', 'APPLICATION_SUBMISSION_RECOVERED', $3::jsonb)`, [applicationId, fromStatus, JSON.stringify({ ...evidence, attemptId })]);
      return { applicationId, confirmationUrl: evidence.confirmationUrl, externalApplicationId: evidence.externalApplicationId };
    });
  }

  async resolveUnknownAsDefinitiveFailure(applicationId: string, reason: string, verificationSource: "INDEPENDENT_REJECTION"): Promise<boolean> {
    if (!reason.trim()) throw new Error("A definitive rejection reason is required.");
    return this.database.transaction(async (client) => {
      const current = await client.query<{ status: string }>(`SELECT status FROM applications WHERE id = $1 FOR UPDATE`);
      if (current.rows[0]?.status !== "SUBMISSION_UNKNOWN") return false;
      const latest = await client.query<{ id: string }>(`SELECT id FROM application_attempts WHERE application_id = $1 ORDER BY attempted_at DESC, id DESC LIMIT 1`);
      const attemptId = latest.rows[0]?.id ?? null;
      if (attemptId) await client.query(`UPDATE application_attempts SET outcome = 'DEFINITIVE_FAILURE', submitted = FALSE, phase = 'FINALIZED', reason = $2, ambiguity_reason = NULL, updated_at = NOW() WHERE id = $1`, [attemptId, reason]);
      await client.query(`UPDATE applications SET status = 'SUBMISSION_FAILED', updated_at = NOW() WHERE id = $1`, [applicationId]);
      await client.query(`INSERT INTO application_events (application_id, from_status, to_status, event_type, metadata) VALUES ($1, 'SUBMISSION_UNKNOWN', 'SUBMISSION_FAILED', 'APPLICATION_SUBMISSION_RECONCILED_FAILURE', $2::jsonb)`, [applicationId, JSON.stringify({ attemptId, reason, verificationSource })]);
      return true;
    });
  }
}

interface StaleSubmissionEvidenceRow {
  id: string; candidate_profile_id: string; company_name: string; target_url: string; updated_at: Date;
  attempt_id: string | null; attempt_outcome: ApplicationSubmissionOutcome | null; attempt_phase: string | null;
  idempotency_key: string | null; task_id: string | null; task_status: string | null; task_lease_expires_at: Date | null;
  confirmation_url: string | null; external_application_id: string | null; final_url: string | null; response_status: number | null;
  request_sent_at: Date | null; response_received_at: Date | null; confirmation_attempted_at: Date | null; confirmation_received_at: Date | null;
  ambiguity_reason: string | null; metadata: Record<string, unknown> | null;
}
