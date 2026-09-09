import { BrowserSessionService } from "./BrowserSession";
import { ApplicationAdapterRegistry, ApplicationContext, ApplicationSubmissionResult } from "./ApplicationAdapter";
import { ApplicationSubmissionRequest } from "./ApplicationSubmissionRequest";
import { ApplicationFlowController } from "./ApplicationFlowController";
import { CandidateProfile } from "../candidates/CandidateProfile";
import { ApplicationRepository } from "./ApplicationRepository";
import { ApplicationTargetResolver } from "./ApplicationTargetResolver";

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
    private readonly applications: Pick<ApplicationRepository, "beginSubmission" | "cancelSubmission" | "markSubmitted">,
    private readonly detector = undefined,
    private readonly mapper = undefined,
    private readonly filler = undefined,
    private readonly safetyGate = undefined,
    private readonly targetResolver = new ApplicationTargetResolver(),
    private readonly hazardDetector = undefined,
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

      const flow = this.flowController ?? new ApplicationFlowController();
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

      const result = await adapter.submit(session.page, resolvedContext);
      if (!result.submitted) {
        await this.applications.cancelSubmission(request.context.applicationId, result.reason);
        return {
          submitted: false,
          safetyAllowed: true,
          reason: result.reason,
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
