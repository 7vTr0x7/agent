import { BrowserSessionService } from "./BrowserSession";
import { ApplicationAdapterRegistry, ApplicationContext, ApplicationSubmissionResult } from "./ApplicationAdapter";
import { ApplicationFieldMapper } from "./ApplicationFieldMapper";
import { ApplicationFormFiller } from "./ApplicationFormFiller";
import { FormFieldDetector } from "./FormFieldDetector";
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
        return { submitted: false, safetyAllowed: false, reason: target.reason, adapterName: null, result: null };
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

      if (this.flowController) {
        const flow = await this.flowController.prepare(session.page, request.candidateProfile);
        if (!flow.safe) {
          return {
            submitted: false,
            safetyAllowed: false,
            reason: flow.reason,
            adapterName: adapter.name,
            result: null
          };
        }
      }

      if (this.dryRun) {
        return {
          submitted: false,
          safetyAllowed: true,
          reason: "APPLICATION_DRY_RUN is enabled; submission was not attempted.",
          adapterName: adapter.name,
          result: null
        };
      }

      const reservation = await this.applications.beginSubmission(
        request.context.jobOpportunityId,
        request.candidateProfile.id,
        request.companyName,
        request.excludedCompanies
      );

      if (!reservation.allowed) {
        return {
          submitted: false,
          safetyAllowed: false,
          reason: reservation.reason,
          adapterName: adapter.name,
          result: null
        };
      }

      const result = await adapter.submit(session.page, request.context);
      if (!result.submitted) {
        return {
          submitted: false,
          safetyAllowed: true,
          reason: result.reason,
          adapterName: adapter.name,
          result
        };
      }

      await this.applications.markSubmitted(reservation.applicationId);

      return {
        submitted: true,
        safetyAllowed: true,
        reason: result.reason,
        adapterName: adapter.name,
        result
      };
    } finally {
      await session.close();
    }
  }
}