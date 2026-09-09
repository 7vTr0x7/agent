import { BrowserSessionService } from "./BrowserSession";
import { ApplicationAdapterRegistry, ApplicationContext, ApplicationSubmissionResult } from "./ApplicationAdapter";
import { ApplicationFieldMapper } from "./ApplicationFieldMapper";
import { ApplicationFormFiller } from "./ApplicationFormFiller";
import { SubmissionSafetyGate } from "./SubmissionSafetyGate";
import { ApplicationTargetResolver } from "./ApplicationTargetResolver";
import { ApplicationHazardDetector } from "./ApplicationHazardDetector";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { ApplicationRepository } from "./ApplicationRepository";
import { ApplicationFlowController } from "./ApplicationFlowController";

export interface ApplicationSubmissionRequest {
  context: ApplicationContext;
  companyName: string;
  excludedCompanies: readonly string[];
  candidateProfile: CandidateProfile;
}

export interface ApplicationSubmissionOutcome {
  submitted: boolean;
  safetyAllowed: boolean;
  reason: string;
  adapterName: string | null;
  result: ApplicationSubmissionResult | null;
}

export class ApplicationSubmissionService {
  constructor(
    private readonly browserSessions: BrowserSessionService,
    private readonly adapters: ApplicationAdapterRegistry,
    private readonly applications: Pick<ApplicationRepository, "beginSubmission" | "markSubmitted">,
    private readonly detector = new FormFieldDetector(),
    private readonly mapper = new ApplicationFieldMapper(),
    private readonly filler = new ApplicationFormFiller(),
    private readonly safetyGate = new SubmissionSafetyGate(),
    private readonly targetResolver = new ApplicationTargetResolver(),
    private readonly hazardDetector = new ApplicationHazardDetector(),
    private readonly dryRun = false,
    private readonly flowController?: ApplicationFlowController
  ) {}

  async submit(request: ApplicationSubmissionRequest): Promise<ApplicationSubmissionOutcome> {
    const session = await this.browserSessions.create();

    try {
      await session.page.goto(request.context.url, { waitUntil: "domcontentloaded" });

      const target = await this.targetResolver.resolve(session.page, request.context.url);
      if (!target.resolved) {
        return {
          submitted: false,
          safetyAllowed: false,
          reason: target.reason,
          adapterName: null,
          result: null
        };
      }

      const adapter = this.adapters.resolve(target.url);
      if (!adapter) {
        return {
          submitted: false,
          safetyAllowed: false,
          reason: "No application adapter can safely handle the resolved application URL.",
          adapterName: null,
          result: null
        };
      }

      const resolvedContext: ApplicationContext = {
        ...request.context,
        url: target.url
      };

      const flow = this.flowController ?? new ApplicationFlowController(
        this.detector,
        this.mapper,
        this.filler,
        this.safetyGate,
        this.hazardDetector
      );
      const prepared = await flow.prepare(
        session.page,
        request.candidateProfile,
        request.companyName,
        request.excludedCompanies
      );

      if (!prepared.allowed) {
        return {
          submitted: false,
          safetyAllowed: false,
          reason: prepared.reasons.join(" "),
          adapterName: adapter.name,
          result: null
        };
      }

      if (this.dryRun) {
        return {
          submitted: false,
          safetyAllowed: true,
          reason: `Dry run completed across ${prepared.pagesProcessed} application page(s): fields were mapped and filled, every page passed the safety gate, and no application was submitted.`,
          adapterName: adapter.name,
          result: null
        };
      }

      const reserved = await this.applications.beginSubmission(request.context.applicationId);
      if (!reserved) {
        return {
          submitted: false,
          safetyAllowed: true,
          reason: "Application submission is already in progress or has already been completed; automatic resubmission is blocked.",
          adapterName: adapter.name,
          result: null
        };
      }

      // Once the durable submission reservation is acquired, the outcome is
      // fail-closed. We deliberately never reset SUBMISSION_IN_PROGRESS here:
      // a browser/provider failure after reservation can have an unknown
      // external outcome, and retrying could submit the same application twice.
      const result = await adapter.submit(session.page, resolvedContext);
      if (!result.submitted) {
        return {
          submitted: false,
          safetyAllowed: true,
          reason: `${result.reason} Submission remains in progress for manual/independent verification; it will not be automatically retried.`,
          adapterName: adapter.name,
          result
        };
      }

      await this.applications.markSubmitted(
        request.context.applicationId,
        result.confirmationUrl,
        result.externalApplicationId
      );

      return {
        submitted: true,
        safetyAllowed: true,
        reason: result.reason,
        adapterName: adapter.name,
        result
      };
    } finally {
      await this.browserSessions.close(session);
    }
  }
}