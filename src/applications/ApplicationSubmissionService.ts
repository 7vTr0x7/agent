import { BrowserSessionService } from "./BrowserSession";
import {
  ApplicationAdapter,
  ApplicationAdapterRegistry,
  ApplicationContext,
  ApplicationSubmissionResult,
  normalizeApplicationSubmissionResult
} from "./ApplicationAdapter";
import { ApplicationFieldMapper } from "./ApplicationFieldMapper";
import { ApplicationFormFiller } from "./ApplicationFormFiller";
import { FormFieldDetector } from "./FormFieldDetector";
import { SubmissionSafetyGate } from "./SubmissionSafetyGate";
import { ApplicationTargetResolver } from "./ApplicationTargetResolver";
import { ApplicationHazardDetector } from "./ApplicationHazardDetector";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { ApplicationRepository } from "./ApplicationRepository";
import { ApplicationFlowController } from "./ApplicationFlowController";
import { SubmissionRequestTracker } from "./SubmissionRequestTracker";

export interface ApplicationSubmissionRequest {
  context: ApplicationContext;
  companyName: string;
  excludedCompanies: readonly string[];
  candidateProfile: CandidateProfile;
  taskId?: string;
  workerId?: string;
  assertTaskOwnership?: () => Promise<boolean>;
}

export interface ApplicationSubmissionOutcome {
  submitted: boolean;
  outcome?: "CONFIRMED_SUCCESS" | "DEFINITIVE_FAILURE" | "AMBIGUOUS" | "NOT_SUBMITTED";
  safetyAllowed: boolean;
  reason: string;
  adapterName: string | null;
  result: ApplicationSubmissionResult | null;
  attemptId?: string;
}

const DEFAULT_NAVIGATION_TIMEOUT_MS = 30_000;
const DEFAULT_SUBMISSION_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export class ApplicationSubmissionService {
  constructor(
    private readonly browserSessions: BrowserSessionService,
    private readonly adapters: ApplicationAdapterRegistry,
    private readonly applications: Pick<
      ApplicationRepository,
      "beginSubmission" | "beginSubmissionAttempt" | "updateSubmissionAttemptPhase" | "finalizeSubmissionAttempt" | "markSubmitted"
    >,
    private readonly detector = new FormFieldDetector(),
    private readonly mapper = new ApplicationFieldMapper(),
    private readonly filler = new ApplicationFormFiller(),
    private readonly safetyGate = new SubmissionSafetyGate(),
    private readonly targetResolver = new ApplicationTargetResolver(),
    private readonly hazardDetector = new ApplicationHazardDetector(),
    private readonly dryRun = false,
    private readonly flowController = new ApplicationFlowController(),
    private readonly navigationTimeoutMs = DEFAULT_NAVIGATION_TIMEOUT_MS,
    private readonly submissionTimeoutMs = DEFAULT_SUBMISSION_TIMEOUT_MS
  ) {}

  async submit(request: ApplicationSubmissionRequest): Promise<ApplicationSubmissionOutcome> {
    const session = await this.browserSessions.create();
    let reservation: { attemptId: string; idempotencyKey: string } | null = null;
    let tracker: SubmissionRequestTracker | null = null;

    try {
      session.page.setDefaultNavigationTimeout(this.navigationTimeoutMs);
      session.page.setDefaultTimeout(this.navigationTimeoutMs);
      await withTimeout(
        session.page.goto(request.context.url, { waitUntil: "domcontentloaded" }),
        this.navigationTimeoutMs,
        "Application page navigation timed out before submission; no submission attempt was started."
      );

      const target = await this.targetResolver.resolve(session.page, request.context.url);
      if (!target.resolved) {
        return { submitted: false, outcome: "NOT_SUBMITTED", safetyAllowed: false, reason: target.reason, adapterName: null, result: null };
      }

      const adapter = this.adapters.resolve(target.url);
      if (!adapter) {
        return {
          submitted: false,
          outcome: "NOT_SUBMITTED",
          safetyAllowed: false,
          reason: "No application adapter can safely handle the resolved application URL.",
          adapterName: null,
          result: null
        };
      }

      const flow = await this.flowController.prepare(
        session.page,
        request.candidateProfile,
        request.companyName,
        request.excludedCompanies
      );
      if (!flow.allowed) {
        return {
          submitted: false,
          outcome: "NOT_SUBMITTED",
          safetyAllowed: false,
          reason: flow.reasons.join(" ") || "Application flow was not allowed to proceed safely.",
          adapterName: adapter.name,
          result: null
        };
      }

      if (this.dryRun) {
        return {
          submitted: false,
          outcome: "NOT_SUBMITTED",
          safetyAllowed: true,
          reason: "APPLICATION_DRY_RUN is enabled; submission was not attempted.",
          adapterName: adapter.name,
          result: null
        };
      }

      const beginAttempt = (this.applications as Partial<ApplicationRepository>).beginSubmissionAttempt;
      if (beginAttempt) {
        reservation = await beginAttempt.call(
          this.applications,
          request.context.applicationId,
          request.taskId ?? null,
          request.workerId ?? null,
          target.url
        );
      } else {
        const reserved = await this.applications.beginSubmission(request.context.applicationId);
        if (!reserved) {
          return {
            submitted: false,
            outcome: "NOT_SUBMITTED",
            safetyAllowed: true,
            reason: "Application has already been completed or is otherwise not eligible for submission.",
            adapterName: adapter.name,
            result: null
          };
        }
      }

      if (!reservation) {
        return {
          submitted: false,
          outcome: "NOT_SUBMITTED",
          safetyAllowed: true,
          reason: "Application has already been completed, is ambiguous, or is otherwise not eligible for submission.",
          adapterName: adapter.name,
          result: null
        };
      }

      const updatePhase = (this.applications as Partial<ApplicationRepository>).updateSubmissionAttemptPhase;
      const finalize = (this.applications as Partial<ApplicationRepository>).finalizeSubmissionAttempt;
      if (!updatePhase || !finalize) {
        // Compatibility path for legacy test doubles. Production always uses
        // the durable attempt lifecycle above.
        const legacyResult = await this.runLegacySubmission(adapter, session.page, request.context);
        if (!legacyResult.submitted) {
          return {
            submitted: false,
            outcome: legacyResult.outcome ?? "AMBIGUOUS",
            safetyAllowed: true,
            reason: `Submission remains in progress because the application provider could not confirm completion. ${legacyResult.reason}`,
            adapterName: adapter.name,
            result: legacyResult,
            attemptId: reservation.attemptId
          };
        }
        await this.applications.markSubmitted(request.context.applicationId, legacyResult.confirmationUrl, legacyResult.externalApplicationId);
        return {
          submitted: true,
          outcome: "CONFIRMED_SUCCESS",
          safetyAllowed: true,
          reason: legacyResult.reason,
          adapterName: adapter.name,
          result: legacyResult,
          attemptId: reservation.attemptId
        };
      }

      const owned = request.assertTaskOwnership ? await request.assertTaskOwnership() : true;
      if (!owned) {
        const notSubmitted: ApplicationSubmissionResult = {
          submitted: false,
          outcome: "NOT_SUBMITTED",
          externalApplicationId: null,
          confirmationUrl: null,
          reason: "Task lease ownership was lost before external submission; the application was not submitted by this worker."
        };
        const evidence = {
          requestObserved: false,
          requestSentAt: null,
          responseObserved: false,
          responseReceivedAt: null,
          responseStatus: null,
          finalUrl: target.url
        };
        await finalize.call(this.applications, request.context.applicationId, reservation.attemptId, { ...notSubmitted, evidence });
        return { submitted: false, outcome: "NOT_SUBMITTED", safetyAllowed: true, reason: notSubmitted.reason, adapterName: adapter.name, result: notSubmitted, attemptId: reservation.attemptId };
      }

      const startedAt = new Date();
      const phasePersisted = await updatePhase.call(this.applications, reservation.attemptId, "EXECUTING", {
        submissionStartedAt: startedAt,
        finalUrl: target.url
      });
      if (!phasePersisted) {
        throw new Error("Application submission attempt could not be marked as executing; external submission was not attempted.");
      }

      tracker = new SubmissionRequestTracker(session.page);
      tracker.start();

      let adapterResult: ApplicationSubmissionResult;
      try {
        adapterResult = await withTimeout(
          adapter.submit(session.page, request.context),
          this.submissionTimeoutMs,
          "Application submission operation timed out. The external submission outcome is ambiguous until reconciled."
        );
      } catch (error) {
        const evidence = tracker.snapshot();
        const timeoutResult: ApplicationSubmissionResult = {
          submitted: false,
          outcome: evidence.requestObserved ? "AMBIGUOUS" : "NOT_SUBMITTED",
          externalApplicationId: null,
          confirmationUrl: null,
          reason: error instanceof Error ? error.message : String(error)
        };
        const normalized = normalizeApplicationSubmissionResult(timeoutResult, evidence);
        await finalize.call(this.applications, request.context.applicationId, reservation.attemptId, normalized);
        return {
          submitted: false,
          outcome: normalized.outcome,
          safetyAllowed: true,
          reason: normalized.reason,
          adapterName: adapter.name,
          result: normalized,
          attemptId: reservation.attemptId
        };
      } finally {
        tracker.stop();
      }

      const evidence = tracker.snapshot();
      const phase = evidence.requestObserved ? "REQUEST_OBSERVED" : "CONFIRMING";
      await updatePhase.call(this.applications, reservation.attemptId, phase, {
        requestSentAt: evidence.requestSentAt,
        responseReceivedAt: evidence.responseReceivedAt,
        responseStatus: evidence.responseStatus,
        finalUrl: evidence.finalUrl,
        confirmationAttemptedAt: new Date()
      });

      const normalized = normalizeApplicationSubmissionResult(adapterResult, evidence);
      if (normalized.outcome === "AMBIGUOUS") {
        normalized.reason = `${normalized.reason} Automatic resubmission is permanently blocked until reconciliation determines the outcome.`;
      }

      const finalized = await finalize.call(this.applications, request.context.applicationId, reservation.attemptId, normalized);
      if (!finalized) {
        return {
          submitted: false,
          outcome: "AMBIGUOUS",
          safetyAllowed: true,
          reason: "Submission outcome was produced after application state changed; no database overwrite or resubmission was performed.",
          adapterName: adapter.name,
          result: normalized,
          attemptId: reservation.attemptId
        };
      }

      return {
        submitted: normalized.outcome === "CONFIRMED_SUCCESS",
        outcome: normalized.outcome,
        safetyAllowed: true,
        reason: normalized.reason,
        adapterName: adapter.name,
        result: normalized,
        attemptId: reservation.attemptId
      };
    } finally {
      if (tracker) tracker.stop();
      try {
        await this.browserSessions.close(session);
      } catch {
        // Browser cleanup must never overwrite the persisted application outcome.
      }
    }
  }

  private async runLegacySubmission(
    adapter: ApplicationAdapter,
    page: any,
    context: ApplicationContext
  ): Promise<ApplicationSubmissionResult> {
    return adapter.submit(page, context);
  }
}
